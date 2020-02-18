import React from 'react';

// General
import { Helmet } from 'react-helmet';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import Mousetrap from 'mousetrap';

// SVG
import SVGInline from 'react-svg-inline';
import SVGS from '../../tools/svg';

// Moment
import moment from 'moment';
import 'moment/locale/ko';

// Firebase
import firebaseCfg from '../../firebase.conf';
import firebase from 'firebase/app';
import 'firebase/database';
import 'firebase/auth';
import Rebase from 're-base';

// Sass
import './Pomodoro.scss';

const app = firebase.initializeApp({ ...firebaseCfg });
const base = Rebase.createClass(app.database());

const thisYear = 'y' + moment().year();
const thisWeekOfYear = 'w' + moment().week();

// Audio Assets
let audioTicktock = new Audio('songs/ticktock.mp3');
let audioAlarm = new Audio('songs/alarm.mp3');

class Pomodoro extends React.Component {
  constructor() {
    super();

    this.state = {
        // OAuth
        isAuthenticated: localStorage.getItem('isAuthenticated') === 'true' ? true : false || false,

        // Firebase
        users: {},
        pomos: {},
        
        // User
        usersRemainTime: [],
        
        // Call
        receivedCall: [],
        // calledUser: [],
        callHistory: [],
        
        // UI
        dashboard: false,
        dndMode: localStorage.getItem('react-pomodoro-dnd') === 'true' ? true : false || false,
        clockTickSoundMode: localStorage.getItem('react-pomodoro-ticktock') === 'true' ? true : false || false,
        modal: false,
        modalData: {},
        notifications: [],
        
        // Pomodoro
        startDate: new Date(),
        time: 0,
        play: false,
        status: false,
        timeType: 0,
        title: '',

        // To-do
        todoList: [],
        doneTodoList: []
    };

    // Bind
    // Bind early, avoid function creation on render loop
    this.setTimeForCode = this.setTime.bind(this, 1500);
    this.setTimeForSocial = this.setTime.bind(this, 300);
    this.setTimeForCoffee = this.setTime.bind(this, 900)
    this.reset = this.reset.bind(this);
    this.play = this.play.bind(this);
    this.elapseTime = this.elapseTime.bind(this);
    this.switchTab = this.switchTab.bind(this);
    this.todoOnDragEnd = this.todoOnDragEnd.bind(this);

    // User info
    this.UID = null;
    this.NAME = null;
    this.PICTURE = null;

    window.addEventListener('beforeunload', (e) => {
      if(this.state.isAuthenticated) {
        base.update(`users/${this.UID}`, {
          data: {
            online: false,
            status: false
          }
        })
      }
    });

    moment.locale('ko');
  }

  componentDidMount() {
    // BeforeUnload
    window.addEventListener('beforeunload', this.beforeUnloadHandler.bind(this));

    // Set localStorage settings item
    this.setState({ dndMode: localStorage.getItem('react-pomodoro-dnd') === 'true' ? true : false });
    this.setState({ clockTickSoundMode: localStorage.getItem('react-pomodoro-ticktock') === 'true' ? true : false });

    if(this.state.isAuthenticated) this.setSyncUsers();

    firebase.auth().onAuthStateChanged((user) => {
      if (user) {
        this.setAuthenticate(true);

        this.UID = user.uid;
        this.NAME = user.displayName;
        this.PICTURE = user.photoURL;
        
        base.update(`/users/${user.uid}`, {
          data: {
            online: true
          }
        });
        base.fetch(`/calls/history/${user.uid}`, {
          context: this,
          asArray: true,
          queries: {
            limitToLast: 10
          },
          then(data) { this.setState({ callHistory: data.reverse() }) }
        });

        base.bindToState(`/pomos`, {
          context: this,
          state: 'pomos',
          asArray: false
        });
        
        base.fetch(`/todos/${this.UID}/activeTodo`, {
          context: this,
          state: 'todoList',
          asArray: true,
          then(data) {
            this.setState({
              todoList: data
            }, () => {
              base.syncState(`/todos/${this.UID}/activeTodo`, {
                context: this,
                state: 'todoList',
                asArray: true
              });
            })
          }
        });
        
        base.fetch(`/todos/${this.UID}/doneTodo`, {
          context: this,
          state: 'doneTodoList',
          asArray: true,
          then(data) {
            this.setState({
              doneTodoList: data
            }, () => {
              base.syncState(`/todos/${this.UID}/doneTodo`, {
                context: this,
                state: 'doneTodoList',
                asArray: true
              });
            });
          }
        });

        // Send call status
        // this.ref = base.listenTo('calls/live', {
        //   context: this,
        //   asArray: true,
        //   queries: {
        //     orderByChild: 'caller',
        //     equalTo: this.UID
        //   },
        //   then(data) {
        //     this.setState({
        //       calledUser: []
        //     });
        //     data.map((callData, idx) => {
        //       return this.setState({
        //         calledUser: [...this.state.calledUser, callData.callee]
        //       });
        //     });
        //   }
        // })

        // Stand-by receive Call
        this.ref = base.listenTo('calls/live', {
          context: this,
          asArray: true,
          queries: {
            orderByChild: 'callee',
            equalTo: this.UID
          },
          then(data) {
            if(data.length) {
              if(this.state.play) {
                data.map((callData, idx) => {
                  return this.setState({
                    receivedCall: [...this.state.receivedCall, callData]
                  });
                });
              } else {
                data.map((callData, idx) => {
                  return this.readReceivedCall(callData);
                });
              }
            }
          }
        });
      } else {
        this.setAuthenticate(false);
      }
    });

    // Pomodoro
    this.setDefaultTime();
    this.startShortcuts();
    Notification.requestPermission();
  }

  componentWillUnmount() {
    window.removeEventListener('beforeunload', this.beforeUnloadHandler.bind(this));
  }

  beforeUnloadHandler(e) {
    if(this.state.play && this.state.timeType === 1500) {
      e.preventDefault();
      e.returnValue = '뽀모도로가 진행중입니다. 종료하시겠습니까?';
    }
  }

  auth() {
    if(this.state.isAuthenticated) {
      base.update(`/users/${this.UID}`, {
        data: {
          online: false,
          status: false
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
          base.update(`/users/${user.uid}`, {
            data: {
              online: true,
              status: false,
              picture: result.additionalUserInfo.profile.picture
            }
          });
          this.setSyncUsers();
        }

        this.UID = user.uid;
        this.NAME = user.displayName;
        this.PICTURE = user.photoURL;
      })
      .catch(error => {
        this.setAuthenticate(false);
      });
    }
  }

  addNewUser(user) {
    base.post(`/users/${user.uid}`, {
      data: {
        name: user.displayName,
        picture: user.photoURL,
        online: false,
        status: false,
      },
      then(err) {
        if(!err) {
          base.update(`/users/${user.uid}`, {
            data: {
              online: true,
              status: false
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
    base.bindToState('/users', {
      context: this,
      state: 'users',
      asArray: false
    });
  }

  donePomo() {
    let vData = {
      startTime: moment().unix() - 1500,
      doneTime: moment().unix(),
      progressTask: this.state.todoList[0].title
    };

    base.push(`pomos/${this.UID}/${thisYear}/${thisWeekOfYear}`, {
      data: vData
    });
  }

  viewTasks(Id) {
    base.fetch(`/todos/${Id}/doneTodo`, {
      context: this,
      asArray: true
    }).then(data => {
      this.setState({
        userDoneTodos: {
          uid: Id,
          data: data
        }
      });
    }).catch(error => {
      this.setState({
        userDoneTodos: {
          uid: Id,
          data: false
        }
      });
    });
  }

  createCallModal(caller) {
    this.setState({ modal: 'call', modalData: { key: caller, ...this.state.users[caller] } });
  }

  createGeneralModal(msg) {
    this.setState({ modal: 'general', modalData: { message: msg } });
  }

  closeModal() {
    this.setState({ modal: '', modalData: {} });
  }

  createNotification(data) {
    this.setState(prevState => ({ notifications: [...prevState.notifications, data] }));
  }

  closeNotification(index) {
    this.setState(prevState => {
      let arr = [...prevState.notifications];
      arr.splice(index, 1);

      return { notifications: arr }
    });
  }

  callUser(calleeId, message) {
    // if(this.state.calledUser.find((calleeIds) => { return calleeIds === calleeId }) !== calleeId) {
      base.push(`/calls/live`, {
        data: {
          caller: this.UID,
          callee: calleeId,
          message: message,
          sendDate: moment().unix()
        }
      })
      .then(data => {
        if(this.state.users[calleeId].status) {
          this.createNotification({
            type: 'call',
            message: '메세지가 전송되었습니다. 상대의 뽀모도로가 종료되는 즉시 메세지가 전달됩니다.'
          });
        } else {
          this.createNotification({
            type: 'call',
            message: '메세지가 전송되었습니다.'
          });
        }
      });

      this.closeModal();
    // } else {
      // return false;
    // }
  }

  readReceivedCall(callData) {

    base
    .remove(`calls/live/${callData.key}`)
    .then(() => {
      base.push(`calls/history/${this.UID}`, {
        data: {
          ...callData,
          readDate: moment().unix()
        },
        catch(error) {
          console.error(error);
        }
      });
      this.setState((prevState) => { return {
        receivedCall: [],
        callHistory: [callData, ...prevState.callHistory]
      }});
    })
    .catch(error => {
      console.error(error);
    });

    if(this.refs.notification.checked) {
      new Notification(`incoming call from ${ this.state.users[callData.caller].name }`, {
        icon: "img/coffee.png",
        lang: "ko",
        body: callData.message
      });
    } else {
      this.createNotification({
        type: 'call',
        message: callData.message
      })
    }
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
    let idx = [...e.target.parentNode.children].indexOf(clickedItem);
    let container = this.refs.dashboardContainer;
    let activeContainer = Array.from(container.childNodes);

    remainItems.splice(idx, 1);

    container.classList.add('is-moving');

    // Switch Tab button
    clickedItem.classList.add('is-active');
    remainItems.forEach(element => element.classList.remove('is-active'));

    // Switch Container
    activeContainer.forEach(element => element.classList.remove('is-active'));
    activeContainer[idx].classList.add('is-active');

    setTimeout(() => {
      container.classList.remove('is-moving');
    }, 300);
    container.style.transform = `translateX(-${ idx * container.clientWidth }px)`
  }
  
  // Pomodoro
  elapseTime() {
    if (this.state.time === 0) {
      this.reset(0);
      this.alert();
      if(this.state.timeType === 1500) {
        this.donePomo();
        this.setTimeForSocial();
        this.play()
        if(this.state.receivedCall.length) {
          this.state.receivedCall.map((callData, idx) => {
            return this.readReceivedCall(callData);
          });
        }
      } 
    }
    if (this.state.play === true) {
      let diff = moment(this.state.startDate).diff(new Date());
      let diffSec = Math.trunc((moment.duration(diff) * -1) / 1000);
      let newSec = this.state.timeType - diffSec;
      this.setState({ time: newSec, title: this.getTitle(newSec)});

      if(this.state.clockTickSoundMode) {
        audioTicktock.play();
      }

      let clockPos = 60 - Math.ceil(newSec / (Math.ceil(this.state.timeType / 60)));
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
    this.setState({ startDate: moment(new Date()) });
    this.interval = setInterval(this.elapseTime, 1000);
  }

  play() {
    if (true === this.state.play) return;
    if (this.state.play === false && this.state.time === 0) return;
    if (this.state.todoList.length === 0) {
      new Notification("You must add at least one todo.", {
        icon: "img/code.png",
        lang: "en",
        body: ""
      });

      return;
    }

    this.restartInterval();
    
    this.setState({ 
      play: true 
    });

    if(this.state.isAuthenticated) {
      switch(this.state.timeType) {
        case 1500:
          this.setState({ status: 'working' });
          base.update(`users/${this.UID}`, {
            data: {
              status: 'working'
            }
          });
          break;
        case 900:
          this.setState({ status: 'conference' });
          base.update(`users/${this.UID}`, {
            data: {
              status: 'conference'
            }
          });
          break;
        case 300:
          this.setState({ status: 'rest' });
          base.update(`users/${this.UID}`, {
            data: {
              status: 'rest'
            }
          });
          break;
        default:
          base.update(`users/${this.UID}`, {
            data: {
              status: false
            }
          });
      }
    }
  }

  resetConfirm(confirm) {
    confirm ? this.reset() : this.closeModal();
  }

  reset(resetFor = this.state.time) {
    clearInterval(this.interval);
    this.format(resetFor);
    this.setState({ time: this.state.timeType, play: false, status: false });
    this.closeModal();

    if(this.state.receivedCall.length) {
      this.state.receivedCall.map((callData, idx) => {
        return this.readReceivedCall(callData);
      });
    }

    if(this.state.isAuthenticated && this.state.timeType === 1500) {
      base.update(`users/${this.UID}`, {
        data: {
          status: false
        }
      });
    }
  }

  togglePlay(deliver) {
    if (true === this.state.play) {
      this.resetConfirm();
    }

    if(!this.state.modal) return this.play();
  }

  setTime(newTime) {
    this.restartInterval();

    base.update(`users/${this.UID}`, {
      data: {
        status: false
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
    Mousetrap.bind('space', this.togglePlay.bind(this, 'mousetrap'));
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
    if(item === 'dnd') this.setState({ dndMode: value });
    if(item === 'ticktock') this.setState({ clockTickSoundMode: value });
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
      audioAlarm.play();
      setTimeout(()=> audioAlarm.pause(), 1400);
    }
    // notification
    if(this.refs.notification.checked) {
      if(this.state.timeType === 1500) {
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
    } else {
      if(this.state.timeType === 1500) {
        this.createNotification({
          type: 'call',
          message: 'Go talk or drink a coffee'
        });
      } else {
        this.createNotification({
          type: 'call',
          message: 'Hey, back to code!'
        });
      }
    }
  }

  render() {
    const clockStrokes = [];
    for(let i = 1; i < 61; i++) {
      clockStrokes.push(<div className="stroke" style={{ "transform": `rotate(${ i * 6 }deg)` }} key={ i }></div>);
    }

    return [
      <div id="pomodoro"
        className={`${this.state.play ? 'is-play' : ''} ${this.state.status ? 'is-' + this.state.status : ''} ${this.state.modal ? 'modal-on' : 'modal-off'} ${this.state.dashboard ? 'dashboard-active' : 'dashboard-inactive'} ${this.state.dndMode && this.state.play ? 'dnd-on' : 'dnd-off'}`} key="pomodoro"
      >
        <div
          className="dashboard-dimmer"
          onClick={(e) => {
            this.setState((prevState) => {
              return { dashboard: !prevState.dashboard }
            })
          }}
        />
        <div
          className="modal-dimmer"
          onClick={(e) => {
            this.closeModal();
          }}
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
                ? <button className="btn-stop" id="control-stop" onClick={ this.createGeneralModal.bind(this, '뽀모도로 타이머 중지 시, 타이머는 리셋됩니다.\n정말 중지하시겠습니까?') }>
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
          this.state.isAuthenticated && this.UID &&
          <div id="todo-now" className={`${ this.state.status ? 'is-' + this.state.status : 'is-inactive' }`}>
            <div className="inner">
              <div className="thumbnail">
                <div className="status"></div>
                <img className="picture" src={ this.state.users[this.UID].picture } alt={`${this.NAME}의 프로필 사진`} />
              </div>
              <div className="info">
                <strong className="name">{ this.NAME }</strong>
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
              <button className="tab-item is-active" onClick={ this.switchTab }>프로필</button>
              <button className="tab-item" onClick={ this.switchTab }>할 일</button>
              <button className={`tab-item ${this.state.receivedCall.length ? 'badge-on' : ''}`} onClick={ this.switchTab }>호출</button>
              <button className="tab-item" onClick={ this.switchTab }>멤버</button>
            </div>
            <div className="dashboard-container" ref="dashboardContainer">
              <div className="dashboard-content is-active" id="dashboard-setting">
                <div className="profile">
                  <h3 className="menu-title">프로필 요약</h3>
                  <div className={ `member ${ this.state.status ? this.state.status ? 'is-' + this.state.status : 'is-inactive' : 'is-offline' }` }>
                    <div className="member-header">
                      <div className="thumbnail">
                        <div className="status" />
                        <img className="picture" src={ (this.state.users[this.UID] && this.state.users[this.UID].picture) || this.PICTURE } alt={`${ this.NAME }의 프로필 사진`} />
                      </div>
                      <div className="profile-area">
                        <strong className="name">
                          { this.NAME }
                        </strong>
                        <span className="pomo-week">
                          <SVGInline svg={ SVGS['tomato'] } />
                          {
                            this.state.pomos[this.UID] && this.state.pomos[this.UID][thisYear] && this.state.pomos[this.UID][thisYear][thisWeekOfYear]
                            ? <i className="count">{` x ${ Object.keys(this.state.pomos[this.UID][thisYear][thisWeekOfYear]).length }`}</i>
                            : <i className="count"> x 0</i>
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="setting-type">
                  <h3 className="menu-title">뽀모도르 모드</h3>
                  <div className="type-inner">
                    <button
                      className={`button-settype type-working ${this.state.timeType === 1500 ? 'is-selected' : ''}`}
                      onClick={ this.setTimeForCode }
                    >
                      <div className="icon" />
                      <strong className="name">업무중</strong>
                    </button>
                    <button
                      className={`button-settype type-rest ${this.state.timeType === 300 ? 'is-selected' : ''}`}
                      onClick={ this.setTimeForSocial }
                    >
                      <div className="icon" />
                      <strong className="name">휴식중</strong>
                    </button>
                    <button
                      className={`button-settype type-conference ${this.state.timeType === 900 ? 'is-selected' : ''}`}
                      onClick={ this.setTimeForCoffee }
                    >
                      <div className="icon" />
                      <strong className="name">회의시간</strong>
                    </button>
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
                        <strong className="label-name">시계침 소리</strong>
                        <span className="label-desc">뽀모도로 진행시 시계침 소리가 재생됩니다.</span>
                      </div>
                      <div className="control">
                        <input 
                          type="checkbox" 
                          ref="ticktock" 
                          id="ticktock"
                          defaultChecked={this.state.clockTickSoundMode}
                          onChange={this._setLocalStorage.bind(this, 'ticktock')} 
                        />
                        <label htmlFor="ticktock" className="toggle" />
                      </div>
                    </li>
                    <li className="option is-disableable">
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
                    this.state.todoList.length < 6 &&
                    <form onSubmit={e => {
                      e.preventDefault();

                      if(this.refs.todoText.value.length > 0) {
                        this.setState({ todoList: [...this.state.todoList, { title: this.refs.todoText.value, createDate: moment().unix() }] })
                        this.refs.todoText.value = '';
                      } else {
                        return false;
                      }
                    }}>
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
                        >
                          추가
                        </button>
                      </div>
                    </form>
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
                  this.state.users && !!this.state.receivedCall.length &&
                  <div className="calls-list type-unread">
                    <strong className="list-title">읽지 않은 메세지</strong>
                    {
                      this.state.receivedCall.map((item, index) => {
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
                  this.state.users && !!this.state.callHistory.length &&
                  <div className="calls-list type-read">
                    <strong className="list-title">읽은 메세지</strong>
                    {
                      this.state.callHistory.map((item, index) => {
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
                      if(key === this.UID) return false;
                      if(key === 'null') return false;

                      return (
                        <li
                          className={ `member ${ data.online ? data.status ? 'is-' + data.status : 'is-inactive' : 'is-offline' }` }
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
                                    data.status
                                    ? '업무중'
                                    : ''
                                  }
                                </span>
                              </strong>
                              <span className="pomo-week">
                                <SVGInline svg={ SVGS['tomato'] } />
                                {
                                  this.state.pomos[key] && this.state.pomos[key][thisYear] && this.state.pomos[key][thisYear][thisWeekOfYear]
                                  ? <i className="count">{` x ${ Object.keys(this.state.pomos[key][thisYear][thisWeekOfYear]).length }`}</i>
                                  : <i className="count"> x 0</i>
                                }
                              </span>
                            </div>
                            <div className="button-area">
                              <button className="button btn-tasks" onClick={ this.viewTasks.bind(this, key) }>View all tasks</button>
                              {
                                data.online
                                ? <button className="button btn-call" onClick={ this.createCallModal.bind(this, key) }>Call</button>
                                : <button className="button btn-call" disabled={ true }>Call</button>
                              }
                            </div>
                          </div>
                          <ul className="donetodo-area">
                            {
                              this.state.userDoneTodos && this.state.userDoneTodos.uid === key &&
                              this.state.userDoneTodos.data.map((data, idx) => {
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
                    if(key === this.UID) return false;
                    if(key === 'null') return false;

                    return (
                      <li
                        className={ `member ${ data.online ? data.status ? 'is-' + data.status : 'is-inactive' : 'is-offline' }` }
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
          ? this.NAME && (
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
      </div>,
      <div id="modal" className={ this.state.modal ? 'type-' + this.state.modal : '' } key="modal">
        {
          this.state.modal === 'call' &&
          <div className="inner">
            <h2 className="title">Call</h2>
            <div className={`profile-area ${this.state.users[this.state.modalData.key].status ? 'is-' + this.state.users[this.state.modalData.key].status : 'is-inactive'}`}>
              <div className="thumbnail">
                <div className="status" />
                <img className="picture" src={ this.state.modalData.picture } alt={`${this.state.modalData.name}의 프로필 사진`} />
              </div>
              <div className="info">
                <strong className="name">{ this.state.modalData.name }</strong>
                {
                  this.state.users[this.state.modalData.key].status === 'working' &&
                  <span className="is-working">업무중</span>
                }
              </div>
            </div>
            <form onSubmit={e => {
              e.preventDefault(); 
                    
              if(this.refs.callText.value.length > 0) {
                this.callUser(this.state.modalData.key, this.refs.callText.value);
              } else {
                alert('내용을 입력해주세요.');
              }
            }}>
              <div className="input-area">
                <input
                  type="text"
                  placeholder="메세지"
                  maxLength="100"
                  ref="callText"
                />
              </div>
              <div className="button-area">
                <button
                  className="button btn-normal"
                  onClick={(e) => {
                    e.preventDefault();

                    this.closeModal();
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button btn-primary"
                >
                  Call
                </button>
              </div>
            </form>
          </div>
        }
        {
          this.state.modal === 'general' &&
          <div className="inner">
            <h2 className="title">Caution</h2>
            <p className="message">
              {
                this.state.modalData.message.split('\n').map((text, key) => {
                  return key
                  ? <React.Fragment key={ key }><br />{ text }</React.Fragment>
                  : <React.Fragment key={ key }>{ text }</React.Fragment>
                })
              }
            </p>
            <div className="button-area">
              <button
                className="button btn-primary"
                onClick={ this.resetConfirm.bind(this, false) }
              >
                돌아가기
              </button>
              <button
                type="submit"
                className="button btn-normal"
                onClick={ this.resetConfirm.bind(this, true) }
              >
                중지
              </button>
            </div>
          </div>
        }
      </div>,
      <div id="notifications" key="notifications">
        {
          this.state.notifications.length > 0 &&
          this.state.notifications.map((data, key) => {
            return (
              <div className="notification" onClick={ this.closeNotification.bind(this, key) } key={ key }>
                <div className="icon">
                  {
                    data.type === 'call' &&
                    <SVGInline svg={ SVGS['message'] } />
                  }
                </div>
                <div className="message">
                  { data.message }
                </div>
              </div>
            )
          })
        }
      </div>
    ]
  }
}

export default Pomodoro;