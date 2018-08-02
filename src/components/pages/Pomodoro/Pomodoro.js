import React from 'react';
// import { Link } from 'react-router-dom';

import Mousetrap from 'mousetrap';
import { Helmet } from 'react-helmet';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import Modal from 'react-modal';
import SVGInline from 'react-svg-inline';

import moment from 'moment';
import 'moment/locale/ko';

import './Pomodoro.scss';

import firebaseConf from './firebase.conf';
import firebase from 'firebase/app';
import 'firebase/database';
import 'firebase/auth';

import Rebase from 're-base';

const app = firebase.initializeApp({ ...firebaseConf });
const base = Rebase.createClass(app.database());

const _SVGS = require.context('../../../svgs', true, /\.svg$/)
const SVGS = _SVGS.keys().reduce((images, key) => {
  let _key = key.split('./')[1].split('.svg')[0];
  images[_key] = _SVGS(key);
  return images;
}, {})

const modalStyles = {
  content : {
    top: '50%',
    left: '50%',
    right: 'auto',
    bottom: 'auto',
    marginRight: '-50%',
    transform: 'translate(-50%, -50%)'
  }
};


class Pomodoro extends React.Component {
  constructor() {
    super();

    this.state = {
        // OAuth
        isAuthenticated: localStorage.getItem('isAuthenticated') || false,
        users: {},
        uid: null,
        name: null,
        picture: null,
        pomo: 0,
        status: false,

        // User
        usersRemainTime: [],

        // Call
        standbyCall: [],
        calledUser: [],
        readCall: [],
        
        // UI
        dashboard: false,
        dndMode: localStorage.getItem('react-pomodoro-dnd') || false,
        callModal: false,

        // Pomodoro
        weekOfYear: moment().week(),
        time: 0,
        play: false,
        timeType: 0,
        title: '',

        // To-do
        todoList: [],
        doneTodoList: []
    };

    this.switchTab = this.switchTab.bind(this);
    this.todoOnDragEnd = this.todoOnDragEnd.bind(this);
    // Bind early, avoid function creation on render loop
    this.setTimeForCode = this.setTime.bind(this, 1500);
    this.setTimeForSocial = this.setTime.bind(this, 300);
    this.setTimeForCoffee = this.setTime.bind(this, 900);
    this.reset = this.reset.bind(this);
    this.play = this.play.bind(this);
    this.elapseTime = this.elapseTime.bind(this);

    moment.locale('ko');

    window.addEventListener('beforeunload', (e) => {
      if(this.state.isAuthenticated) {
        base.update(`users/${this.state.uid}`, {
          data: {
            online: false,
            state: false
          }
        })
      }
    });
  }

  componentWillMount() {    
    firebase.auth().onAuthStateChanged((user) => {
      if (user) {
        this.setAuthenticate(true);
        this.setState({
          name: user.displayName,
          uid: user.uid,
          picture: user.photoURL
        })
        
        base.update(`/users/${user.uid}`, {
          data: {
            online: true
          }
        });
        base.fetch(`/users/${user.uid}/readCall`, {
          context: this,
          asArray: true,
          queries: {
            limitToLast: 10
          },
          then(data) { this.setState({ readCall: data.reverse() }) }
        });

        base.fetch(`/users/${this.state.uid}/pomo`, {
          context: this,
          state: 'pomo',
          asArray: false,
          then() {
            base.syncState(`/users/${this.state.uid}/pomo`, {
              context: this,
              state: 'pomo',
              asArray: false
            });
          }
        });
        
        base.fetch(`/users/${this.state.uid}/activeTodo`, {
          context: this,
          state: 'todoList',
          asArray: true,
          then() {
            base.syncState(`/users/${this.state.uid}/activeTodo`, {
              context: this,
              state: 'todoList',
              asArray: true
            });
          }
        });
        
        base.fetch(`/users/${this.state.uid}/doneTodo`, {
          context: this,
          state: 'doneTodoList',
          asArray: true,
          then() {
            base.syncState(`/users/${this.state.uid}/doneTodo`, {
              context: this,
              state: 'doneTodoList',
              asArray: true
            });
          }
        });

        // Send call status
        this.ref = base.listenTo('calls', {
          context: this,
          asArray: true,
          queries: {
            orderByChild: 'caller',
            equalTo: this.state.uid
          },
          then(data) {
            this.setState({
              calledUser: []
            });
            data.map((callData, idx) => {
              return this.setState({
                calledUser: [...this.state.calledUser, callData.callee]
              });
            });
          }
        })

        // Stand-by receive Call
        this.ref = base.listenTo('calls', {
          context: this,
          asArray: true,
          queries: {
            orderByChild: 'callee',
            equalTo: this.state.uid
          },
          then(data) {
            if(data.length) {
              if(this.state.play) {
                data.map((callData, idx) => {
                  return this.setState({
                    standbyCall: [...this.state.standbyCall, callData]
                  });
                });
              } else {
                if(this.refs.notification.checked) {
                  data.map((callData, idx) => {
                    this.readStandbyCall(callData);
                    
                    return new Notification(`incoming call from ${ callData.callerName }`, {
                      icon: "img/coffee.png",
                      lang: "ko",
                      body: callData.message
                    });
                  });
                } else {
                  data.map((callData, idx) => {
                    base.remove(`calls/${ callData.key }`, (err) => {
                      if(err) console.error(err);
                    });
                    
                    return console.log('incoming call but not allowed notification');
                  });
                }
              }
            }
          }
        });
      } else {
        this.setAuthenticate(false);
      }
    });
  }

  componentDidMount() {
    if(this.state.isAuthenticated) this.setSyncUsers();

    // Pomodoro
    this.setDefaultTime();
    this.startShortcuts();
    Notification.requestPermission();
  }

  auth() {
    if(this.state.isAuthenticated) {
      base.update(`users/${this.state.uid}`, {
        data: {
          online: false,
          state: false
        }
      });
      firebase.auth().signOut();
      this.setAuthenticate(false);
    } else {
      let provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({
        hd: 'devunlimit.com',
        login_hint: 'user@devunlimit.com'
      });
      firebase.auth().languageCode = 'kr';
      firebase.auth().signInWithPopup(provider)
      .then(result => {
        let user = result.user;
        this.setAuthenticate(true);

        if(result.additionalUserInfo.isNewUser) {
          this.addNewUser(user);
        } else {
          base.update(`users/${user.uid}`, {
            data: {
              online: true,
              state: false
            }
          });
          this.setSyncUsers();
        }

        this.setState({
          name: user.displayName,
          picture: user.photoURL,
          uid: user.uid
        });
      })
      .catch(error => {
        this.setAuthenticate(false);
      });
    }
  }

  addNewUser(user) {
    base.post(`users/${user.uid}`, {
      data: {
        name: user.displayName,
        picture: user.photoURL,
        online: false,
        state: false,
      },
      then(err) {
        if(!err) {
          base.update(`users/${user.uid}`, {
            data: {
              online: true,
              state: false
            }
          });
        }
      }
    });
    
    this.setAuthenticate(true);
    this.setSyncUsers();
  }

  setAuthenticate(bool) {
    this.setState({ isAuthenticated: bool });
    localStorage.setItem('isAuthenticated', bool);
  }

  setSyncUsers() {
    base.bindToState('users', {
      context: this,
      state: 'users',
      asArray: false
    });
  }

  donePomo() {
    let vData = {};

    base.fetch(`users/${this.state.uid}/pomo/${this.state.weekOfYear}`, {
      context: this,
      asArray: false,
      then(data) {
        if(typeof data === 'object') {
          vData[this.state.weekOfYear] = 1;
          base.post(`users/${this.state.uid}/pomo`, {
            data: vData
          });
        } else {
          vData[this.state.weekOfYear] = ++data;
          base.update(`users/${this.state.uid}/pomo`, {
            data: vData
          });
        }
      }
    });
  }

  viewTasks(Id) {
    if(this.state.viewTaskData && this.state.viewTaskData.uid !== Id) {
      base.fetch(`users/${Id}/doneTodo`, {
        context: this,
        asArray: true,
        then(data) {
          data.length
          ? this.setState({
            viewTaskData: {
              uid: Id,
              data: data
            }
          })
          : this.setState({
            viewTaskData: {
              uid: Id,
              data: false
            }
          })
        }
      });
    } else {
      this.setState({ viewTaskData: {} });
    }
  }

  callUser(calleeId) {
    if(this.state.calledUser.find((calleeIds) => { return calleeIds === calleeId }) !== calleeId) {
      let message = window.prompt();
      if(message) {
        base.push(`/calls`, {
          data: {
            caller: this.state.uid,
            callee: calleeId,
            message: message,
            sendDate: moment().unix()
          }
        });
      } else {
        return false
      }
      return true;
    } else {
      return false;
    }
  }

  readStandbyCall(callData) {
    base
    .remove(`calls/${callData.key}`)
    .then(() => {
      base.push(`users/${this.state.uid}/readCall`, {
        data: {
          ...callData,
          readDate: moment().unix()
        },
        catch(error) {
          console.error(error);
        }
      });
      this.setState((prevState) => { return {
        standbyCall: [],
        readCall: [callData, ...prevState.readCall]
      }});
    })
    .catch(error => {
      console.error(error);
    });
  }

  // To-do
  todoOnDragEnd(result) {
    // dropped outside the list
    if (!result.destination) {
      return;
    }

    const todoList = this.todoListReorder(
      this.state.todoList,
      result.source.index,
      result.destination.index
    );

    this.setState({
      todoList,
    });
  }

  todoListReorder = (list, startIndex, endIndex) => {
    const result = Array.from(list);
    const [removed] = result.splice(startIndex, 1);
    result.splice(endIndex, 0, removed);
  
    return result;
  };

  doneTodo(index) {
    let arr = [...this.state.todoList];
    let todo = this.state.todoList[index];
    todo.doneDate = moment().unix();
    arr.splice(index, 1);
    this.setState({ todoList: arr });

    this.setState((prevState) => { return { doneTodoList: [todo, ...prevState.doneTodoList] } });
  }

  resetTodo(index) {
    let arr = [...this.state.doneTodoList];
    let todo = this.state.doneTodoList[index];
    delete todo['doneDate'];
    delete todo['key'];
    arr.splice(index, 1);
    this.setState({ doneTodoList: arr });

    this.setState((prevState) => { return { todoList: [todo, ...prevState.todoList] } });
  }

  deleteTodo(index, state) {
    if(window.confirm('Are you sure you want to delete?')) {
      let arr = [...this.state[state]];
      arr.splice(index, 1);
      this.setState({ [state]: arr });
    } else {
      return false;
    }
  }

  // UI
  switchTab(e) {
    e.persist();
    
    let clickedItem = e.target;
    let remainItems = Array.from(this.refs.dashboardTab.childNodes);
    let container = this.refs.dashboardContainer;
    let idx = [...e.target.parentNode.children].indexOf(clickedItem);

    remainItems.splice(idx, 1);

    // Switch class
    clickedItem.classList.add('is-active');
    remainItems.forEach(element => element.classList.remove('is-active'));

    // Switch content
    container.style.transform = `translateX(-${ idx * container.clientWidth }px)`
  }
  
  // Pomodoro
  elapseTime() {
    if (this.state.time === 0) {
      this.reset(0);
      this.alert();
      if(this.state.timeType === 1500) {
        this.donePomo();
        if(this.state.standbyCall.length) {
          this.state.standbyCall.map((callData, idx) => {
            this.readStandbyCall(callData);
            
            return new Notification(`incoming call from ${callData.callerName}`, {
              icon: "img/coffee.png",
              lang: "ko",
              body: callData.message
            });
          });
        }
      } 
    }
    if (this.state.play === true) {
      let newState = this.state.time - 1;
      this.setState({ time: newState, title: this.getTitle(newState) });

      let clockPos = 60 - Math.ceil(newState / (Math.ceil(this.state.timeType / 60)));
      if(clockPos) Array.from(this.refs.clockStrokes.childNodes)[clockPos - 1].classList.add('is-passed');
    }
  }

  format(seconds) {
    let m = Math.floor(seconds % 3600 / 60);
    let s = Math.floor(seconds % 3600 % 60);
    let timeFormated = (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    return timeFormated;
  }

  getFormatTypes() {
    return [
      {type: "code", time: 1500},
      {type: "social", time: 300},
      {type: "coffee", time: 900}
    ];
  }

  formatType(timeType) {
    let timeTypes = this.getFormatTypes();
    for(let i=0; i<timeTypes.length; i++) {
      let timeObj = timeTypes[i];
      if(timeObj.time === timeType) {
        return timeObj.type;
      }
    }
    return null;
  }

  restartInterval() {
    clearInterval(this.interval);
    this.interval = setInterval(this.elapseTime, 1000);
  }

  play() {
    if (true === this.state.play) return;
    if (this.state.play === false && this.state.time === 0) return;

    this.restartInterval();
    
    this.setState({ 
      play: true 
    });

    if(this.state.isAuthenticated) {
      switch(this.state.timeType) {
        case 1500:
          this.setState({ status: 'working' });
          base.update(`users/${this.state.uid}`, {
            data: {
              state: 'working'
            }
          });
          break;
        case 900:
          this.setState({ status: 'conference' });
          base.update(`users/${this.state.uid}`, {
            data: {
              state: 'conference'
            }
          });
          break;
        case 300:
          this.setState({ status: 'false' });
          base.update(`users/${this.state.uid}`, {
            data: {
              state: 'rest'
            }
          });
          break;
        default:
          base.update(`users/${this.state.uid}`, {
            data: {
              state: false
            }
          });
      }
    }
  }

  reset(resetFor = this.state.time) {
    clearInterval(this.interval);
    this.format(resetFor);
    this.setState({ play: false, status: false });

    if(this.state.standbyCall.length) {
      this.state.standbyCall.map((callData, idx) => {
        this.readStandbyCall(callData);
        
        return new Notification(`incoming call from ${callData.callerName}`, {
          icon: "img/coffee.png",
          lang: "ko",
          body: callData.message
        });
      });
    }

    if(this.state.isAuthenticated && this.state.timeType === 1500) {
      base.update(`users/${this.state.uid}`, {
        data: {
          state: false
        }
      });
    }
  }

  togglePlay() {
    if (true === this.state.play) {
      return this.reset();
    }

    return this.play();
  }

  setTime(newTime) {
    this.restartInterval();

    base.update(`users/${this.state.uid}`, {
      data: {
        state: false
      }
    });
    
    this.setState({
      time: newTime, 
      timeType: newTime, 
      title: this.getTitle(newTime), 
      play: false
    });

    Array.from(this.refs.clockStrokes.childNodes).forEach((element) => {
      element.classList.remove('is-passed');
    });
  }

  setDefaultTime() {
    let defaultTime = 1500;

    this.setState({
      time: defaultTime, 
      timeType: defaultTime, 
      title: this.getTitle(defaultTime), 
      play: false
    });
  }

  getTitle(time) {
    time = typeof time === 'undefined' ? this.state.time : time;
    let _title = this.format(time) + ' | Team Pomodoro timer';
    return _title;
  }

  startShortcuts() {
    Mousetrap.bind('space', this.togglePlay.bind(this));
    Mousetrap.bind(['shift+left', 'meta+left'], this.toggleMode.bind(this,-1));
    Mousetrap.bind(['shift+right', 'meta+right'], this.toggleMode.bind(this,1));
  }

  toggleMode(gotoDirection) {
    let timeTypes = this.getFormatTypes();
    let currentPosition = -1;


    for (let i = 0; i < timeTypes.length; i++) {
      if (timeTypes[i].time === this.state.timeType) {
        currentPosition = i;
        break;
      };
    };

    if (currentPosition !== -1) {
      let newMode = timeTypes[currentPosition + gotoDirection];
      if (newMode) this.setTime(newMode.time);
    };
  }

  _setLocalStorage (item, element) {
    let value = element.target.checked;
    localStorage.setItem('react-pomodoro-' + item, value);
    if(item === 'dnd') this.setState({ dndMode: value })
  }

  _getLocalStorage (item) {
    return (localStorage.getItem('react-pomodoro-' + item) === 'true') ? true : false;
  }

  alert() {
    // vibration
    // if(this.refs.vibrate.checked) {
    //   window.navigator.vibrate(1000);
    // }
    // audio
    if(this.refs.audio.checked) {
      let audio = new Audio('songs/alarm.mp3');
      audio.play();
      setTimeout(()=> audio.pause(), 1400);
    }
    // notification
    if(this.refs.notification.checked) {
      if (this.state.timeType === 1500) {
        new Notification("Relax :)", {
          icon: "img/coffee.png",
          lang: "en",
          body: "Go talk or drink a coffee."
        });
      } else {
        new Notification("The time is over!", {
          icon: "img/code.png",
          lang: "en",
          body: "Hey, back to code!"
        });
      }
    }
  }

  render() {
    const clockStrokes = [];
    for(let i = 1; i < 61; i++) {
      clockStrokes.push(<div className="stroke" style={{ "transform": `rotate(${ i * 6 }deg)` }} key={ i }></div>);
    }

    return (
      <div id="pomodoro" className={`${this.state.dashboard ? 'dashboard-active' : 'dashboard-inactive'} ${this.state.dndMode && this.state.play ? 'dnd-on' : 'dnd-off'}`}>
        <div
          className="dashboard-dimmer"
          onClick={
            (e) => {
              this.setState((prevState) => {
                return { dashboard: !prevState.dashboard }
              })
            }
          }
        />
        <Helmet>
          <title>{ this.state.title }</title>
          <link rel="stylesheet" type="text/css" href="https://fonts.googleapis.com/earlyaccess/notosanskr.css" />
        </Helmet>
        <div id="clock" className={`${this.state.play ? 'is-active' : 'is-inactive'} ${this.state.time < this.state.timeType ? 'is-started' : ''}`}>
          <div className="clock-strokes" ref="clockStrokes">
            { clockStrokes }
          </div>
          <div className="container">
            <i className="comment">뽀모도로 타이머 종료까지</i>
            <strong className="time">
              { this.format(this.state.time) }
            </strong>
            <div className="control-area">
              {
                this.state.play
                ? <button className="btn-stop" id="control-stop" onClick={ this.reset }>
                  타이머 종료
                </button>
                : <button className="btn-play" id="control-play" onClick={ this.play }>
                타이머 시작
              </button>
              }
            </div>
          </div>
        </div>
        {
          this.state.isAuthenticated && this.state.uid &&
          <div id="todo-now" className={`${ this.state.status ? 'is-' + this.state.status : 'is-inactive' }`}>
            <div className="inner">
              <div className="thumbnail">
                <div className="status"></div>
                <img className="picture" src={ this.state.picture } alt={`${this.state.name}의 프로필 사진`} />
              </div>
              <div className="info">
                <strong className="name">{ this.state.name }</strong>
                {
                  this.state.todoList.length > 0 &&
                  <span className="todo">{ this.state.todoList[0].title }</span>
                }
              </div>
            </div>
          </div>
        }
        <div id="dashboard" className={ this.state.dashboard ? 'is-active' : 'is-inactive' } >
            <div
              className="header"
              onClick={
                (e) => {
                  this.setState((prevState) => {
                    return { dashboard: !prevState.dashboard }
                  })
                }
              }
            >
              <div className="header-timer">
                <span className="label">타이머 종료까지</span>
                <strong className="time">{ this.format(this.state.time) }</strong>
              </div>
              <SVGInline className="header-icon" svg={SVGS['arrow']} />
              <h2 className="header-title">
                { this.state.dashboard ? '타이머로 돌아가기' : 'Dashboard' }
              </h2>
            </div>
            <div className="dashboard-tab" ref="dashboardTab">
              <button className="tab-item is-active" onClick={ this.switchTab }>Preset</button>
              <button className="tab-item" onClick={ this.switchTab }>To-do</button>
              <button className={`tab-item ${this.state.standbyCall.length ? 'badge-on' : ''}`} onClick={ this.switchTab }>Call</button>
              <button className="tab-item" onClick={ this.switchTab }>Members</button>
            </div>
            <div className="dashboard-container" ref="dashboardContainer">
              <div className="dashboard-content" id="dashboard-setting">
                <div className="setting-type">
                  <h3 className="menu-title">뽀모도르 모드</h3>
                  <div className="type-inner">
                    <div
                      className={`button-settype type-working ${this.state.timeType === 1500 ? 'is-selected' : ''}`}
                      onClick={ this.setTimeForCode }
                      role="button"
                    >
                      <div className="icon" />
                      <strong className="name">업무중</strong>
                    </div>
                    <div
                      className={`button-settype type-rest ${this.state.timeType === 300 ? 'is-selected' : ''}`}
                      onClick={ this.setTimeForSocial }
                      role="button"
                    >
                      <div className="icon" />
                      <strong className="name">휴식중</strong>
                    </div>
                    <div
                      className={`button-settype type-conference ${this.state.timeType === 900 ? 'is-selected' : ''}`}
                      onClick={ this.setTimeForCoffee }
                      role="button"
                    >
                      <div className="icon" />
                      <strong className="name">회의시간</strong>
                    </div>
                  </div>
                </div>
                <div className="setting-options">
                  <h3 className="menu-title">뽀모도르 옵션</h3>
                  <ul className="option-list">
                    <li className="option">
                      <div className="label">
                        <strong className="label-name">알림</strong>
                        <span className="label-desc">시간 종료, 메세지 등을 확인할 수 있는 알림을 띄워줍니다.</span>
                      </div>
                      <div className="control">
                        <input 
                          type="checkbox"
                          ref="notification"
                          id="notification"
                          defaultChecked={this._getLocalStorage('notification')}
                          onChange={this._setLocalStorage.bind(this, 'notification')}
                        />
                        <label htmlFor="notification" className="toggle" />
                      </div>
                    </li>
                    <li className="option">
                      <div className="label">
                        <strong className="label-name">소리</strong>
                        <span className="label-desc">시간 종료, 메세지 알림시 사운드를 재생합니다.</span>
                      </div>
                      <div className="control">
                        <input 
                          type="checkbox" 
                          ref="audio" 
                          id="audio"
                          defaultChecked={this._getLocalStorage('audio')}
                          onChange={this._setLocalStorage.bind(this, 'audio')} 
                        />
                        <label htmlFor="audio" className="toggle" />
                      </div>
                    </li>
                    <li className="option">
                      <div className="label">
                        <strong className="label-name">방해금지 모드</strong>
                        <span className="label-desc">UI요소를 최대한 배제하여 업무와 뽀모도로 타이머에만 집중할 수 있게 합니다.</span>
                      </div>
                      <div className="control">
                        <input 
                          type="checkbox" 
                          ref="dnd" 
                          id="dnd"
                          defaultChecked={this._getLocalStorage('dnd')}
                          onChange={this._setLocalStorage.bind(this, 'dnd')} 
                        />
                        <label htmlFor="dnd" className="toggle" />
                      </div>
                    </li>
                  </ul>
                </div>
              </div>
              <div className="dashboard-content" id="dashboard-todo">
                <div className="active-todos">
                  <h3 className="todo-title">생성된 To-do</h3>
                  {
                    !!this.state.todoList.length ?
                    <DragDropContext onDragEnd={ this.todoOnDragEnd } key="todoDnd">
                      <Droppable droppableId="droppable">
                        {(provided, snapshot) => (
                          <div
                            ref={ provided.innerRef }
                            className="todo-list"
                          >
                            {
                              this.state.todoList.map((item, index) => (
                                <Draggable key={ index } draggableId={ index } index={ index }>
                                  {(provided, snapshot) => (
                                    <div
                                      ref={ provided.innerRef }
                                      { ...provided.draggableProps }
                                      className="todo-item"
                                    >
                                      <div className="inner">
                                        <strong className="info-title">{ item.title }</strong>
                                        <span className="info-date">{ moment.unix(item.createDate).format('YYYY-MM-DD HH:MM') }</span>
                                        <div className="todo-btn todo-btn-done">
                                          <div
                                            className="checkbox-done"
                                            role="checkbox"
                                            aria-checked={ false }
                                            onClick={
                                              this.doneTodo.bind(this, index)
                                            }
                                          />
                                        </div>
                                        <div className="todo-btn todo-btn-delete">
                                          <SVGInline
                                            svg={SVGS['trash']}
                                            onClick={
                                              this.deleteTodo.bind(this, index, 'todoList')
                                            }
                                          />
                                        </div>
                                      </div>
                                      <div className="todo-btn todo-btn-grippy" { ...provided.dragHandleProps }>
                                        <SVGInline svg={ SVGS['list_change'] } />
                                      </div>
                                    </div>
                                  )}
                                </Draggable>
                              ))
                            }
                            { provided.placeholder }
                          </div>
                        )}
                      </Droppable>
                    </DragDropContext>
                    : <strong className="no-data">생성된 To-do가 없습니다.</strong>
                  }
                  {
                    this.state.todoList.length < 5 &&
                    <form>
                      <div className="todo-add-area">
                        <div className="input">
                          <input
                            type="text"
                            placeholder="할 일"
                            maxLength="100"
                            ref="todoText"
                            onChange={(e) => {
                              this.refs.todoText.value.length > 0
                              ? this.refs.todoSubmit.removeAttribute('disabled')
                              : this.refs.todoSubmit.setAttribute('disabled', true)
                            }}
                          />
                        </div>
                        <button
                          type="submit"
                          className="submit"
                          ref="todoSubmit"
                          onClick={(e) => {
                            e.preventDefault();

                            if(this.refs.todoText.value.length > 0) {
                              this.setState({ todoList: [...this.state.todoList, { title: this.refs.todoText.value, createDate: moment().unix() }] })
                              this.refs.todoText.value = '';
                            } else {
                              return false;
                            }
                          }}
                        >
                          추가
                        </button>
                      </div>
                    </form>
                    // <div
                    //   className="todo-btn-new"
                    //   onClick={(e) => {
                    //     let title = window.prompt();
                    //     title ? this.setState({ todoList: [...this.state.todoList, { title: title, createDate: moment().unix() }] }) : e.preventDefault();
                    //   }}
                    // >
                      
                    // </div>
                  }
                </div>
                <div className="done-todos">
                  <h3 className="todo-title">완료한 To-do</h3>
                  {
                    !!this.state.doneTodoList.length ?
                    <div className="todo-list">
                      {
                        this.state.doneTodoList.map((item, index) => (
                          <div className="todo-item" key={ index }>
                            <div className="inner">
                              <strong className="info-title">{ item.title }</strong>
                              <span className="info-date">{ moment.unix(item.doneDate).format('YYYY-MM-DD HH:MM') }</span>
                              <div className="todo-btn todo-btn-done">
                                <div
                                  className="checkbox-done"
                                  role="checkbox"
                                  aria-checked={ true }
                                  onClick={
                                    this.resetTodo.bind(this, index)
                                  }
                                >
                                  <SVGInline svg={SVGS['check']} />
                                </div>
                              </div>
                              <div className="todo-btn todo-btn-delete">
                                <SVGInline
                                  svg={SVGS['trash']}
                                  onClick={
                                    this.deleteTodo.bind(this, index, 'doneTodoList')
                                  }
                                />
                              </div>
                            </div>
                          </div>
                        ))
                      }
                    </div>
                    : <strong className="no-data">완료한 To-do가 없습니다.</strong>
                  }
                </div>
              </div>
              <div className="dashboard-content" id="dashboard-call">
                {
                  this.state.users && !!this.state.standbyCall.length &&
                  <div className="calls-list type-unread">
                    <strong className="list-title">읽지 않은 메세지</strong>
                    {
                      this.state.standbyCall.map((item, index) => {
                        return (
                          <div className={ `calls ${ this.state.users[item.caller].online ? this.state.users[item.caller].state ? 'is-' + this.state.users[item.caller].state : 'is-inactive' : 'is-offline' }` } key={ index }>
                            <div className="thumbnail">
                              <div className="status" />
                              <img className="picture" src={ this.state.users[item.caller].picture } alt={`${this.state.users[item.caller].name}의 프로필 사진`} />
                            </div>
                            <div className="inner">
                              <div className="info">
                                <strong className="info-name">{ this.state.users[item.caller].name }</strong>
                                <span className="info-date">{ moment.unix(item.sendDate).fromNow() }</span>
                              </div>
                              <div className="content">
                                <p className="content-message">{ item.message }</p>
                              </div>
                            </div>
                          </div>
                        )
                      })
                    }
                  </div>
                }
                {
                  this.state.users && !!this.state.readCall.length &&
                  <div className="calls-list type-read">
                    <strong className="list-title">읽은 메세지</strong>
                    {
                      this.state.readCall.map((item, index) => {
                        return (
                          <div className={ `calls ${ this.state.users[item.caller].online ? this.state.users[item.caller].state ? 'is-' + this.state.users[item.caller].state : 'is-inactive' : 'is-offline' }` } key={ index }>
                            <div className="thumbnail">
                              <div className="status" />
                              <img className="picture" src={ this.state.users[item.caller].picture } alt={`${this.state.users[item.caller].name}의 프로필 사진`} />
                            </div>
                            <div className="inner">
                              <div className="info">
                                <strong className="info-name">{ this.state.users[item.caller].name }</strong>
                                <span className="info-date">{ moment.unix(item.sendDate).fromNow() }</span>
                              </div>
                              <div className="content">
                                <p className="content-message">{ item.message }</p>
                              </div>
                            </div>
                          </div>
                        )
                      })
                    }
                  </div>
                }
              </div>
              <div className="dashboard-content" id="dashboard-members">
                <ul className="members-list">
                  {
                    this.state.isAuthenticated && this.state.users && Object.keys(this.state.users).map((key, idx) => {
                      let data = this.state.users[key];
                      if(key === this.state.uid) return false;
                      if(key === 'null') return false;

                      return (
                        <li
                          className={ `member ${ data.online ? data.state ? 'is-' + data.state : 'is-inactive' : 'is-offline' }` }
                          key={ idx }
                          data-uid={ key }
                        >
                          <div className="member-header">
                            <div className="thumbnail">
                              <div className="status" />
                              <img className="picture" src={ data.picture } alt={`${data.name}의 프로필 사진`} />
                            </div>
                            <div className="profile-area">
                              <strong className="name">
                                { data.name }
                                <span className="state">
                                  {
                                    data.state
                                    ? '업무중'
                                    : ''
                                  }
                                </span>
                              </strong>
                              <span className="pomo-week">
                                Pomo
                                {
                                  data.pomo && data.pomo[this.state.weekOfYear] && data.pomo[this.state.weekOfYear]
                                  ? <i className="count">{` x ${data.pomo[this.state.weekOfYear]}`}</i>
                                  : <i className="count"> x 0</i>
                                }
                              </span>
                            </div>
                            <div className="button-area">
                              <button className="button btn-tasks" onClick={ this.viewTasks.bind(this, key) }>View all tasks</button>
                              {
                                data.online
                                ? <button className="button btn-call" onClick={ this.callUser.bind(this, key) }>Call</button>
                                : <button className="button btn-call" disabled={ true }>Call</button>
                              }
                            </div>
                          </div>
                          <ul className="donetodo-area">
                            {
                              this.state.viewTaskData && this.state.viewTaskData.uid === key && this.state.viewTaskData.data.map((data, idx) => {
                                return (
                                  <li className="todo" key={ idx }>
                                    <strong>{ data.title }</strong>
                                    <br />
                                    등록: { moment.unix(Number(data.createDate)).format("YYYY-MM-DD HH:mm:ss") }
                                    <br />
                                    완료: { moment.unix(Number(data.doneDate)).format("YYYY-MM-DD HH:mm:ss") }
                                  </li>
                                )
                              })
                            }
                          </ul>
                        </li>
                      )
                    })
                  }
                </ul>
              </div>
            </div>
        </div>
        {
          this.state.isAuthenticated && this.state.users && (
            <div id="members-area">
              <ul className="members-list">
                {
                  Object.keys(this.state.users).map((key, idx) => {
                    let data = this.state.users[key];
                    if(key === this.state.uid) return false;
                    if(key === 'null') return false;

                    return (
                      <li
                        className={ `member ${ data.online ? data.state ? 'is-' + data.state : 'is-inactive' : 'is-offline' }` }
                        key={ idx }
                        data-uid={ key }
                      >
                        <div className="thumbnail">
                          <div className="status" />
                          <img className="picture" src={ data.picture } alt={`${data.name}의 프로필 사진`} />
                        </div>
                        <div className="name">{ data.name }</div>
                      </li>
                    )
                  })
                }
              </ul>
            </div>
          )
        }
        {
          this.state.isAuthenticated
          ? this.state.name && (
            <div id="auth-area">
              <div id="customBtn" className="customGPlusSignIn" onClick={() => this.auth('google')}>
                <span className="icon"></span>
                <span className="buttonText">Sign Out</span>
              </div>
            </div>
          ) : (
            <div id="auth-area">
              <div id="customBtn" className="customGPlusSignIn" onClick={() => this.auth('google')}>
                <span className="icon"></span>
                <span className="buttonText">Sign In / Sign Up</span>
              </div>
            </div>
          )
        }
      </div>
    )
  }
}

export default Pomodoro;