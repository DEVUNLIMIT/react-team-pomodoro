import React from 'react';
// import { Link } from 'react-router-dom';

import Mousetrap from 'mousetrap';
import { Helmet } from 'react-helmet';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSquare, faCheckSquare } from '@fortawesome/free-regular-svg-icons';
import { faTrashAlt, faPlus } from '@fortawesome/free-solid-svg-icons';


import moment from 'moment';

import './Pomodoro.scss';

import firebaseConf from './firebase.conf';
import firebase from 'firebase/app';
import 'firebase/database';
import 'firebase/auth';

import Rebase from 're-base';

const app = firebase.initializeApp({ ...firebaseConf });
const base = Rebase.createClass(app.database());

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

        // Call
        standbyCall: [],
        calledUser: [],
        unreadCall: [],
        readCall: [],
        
        // UI
        dashboard: false,

        // Pomodoro
        weekOfYear: moment().week(),
        time: 0,
        play: false,
        timeType: 0,
        title: '',

        // To-do
        todoList: [],
        doneTodoList: [],
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
        base.syncState(`/users/${user.uid}/pomo`, {
          context: this,
          state: 'pomo',
          asArray: false
        });
        base.syncState(`/users/${user.uid}/activeTodo`, {
          context: this,
          state: 'todoList',
          asArray: true
        });
        base.syncState(`/users/${user.uid}/doneTodo`, {
          context: this,
          state: 'doneTodoList',
          asArray: true
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
        then(error) {
          console.error(error);
        }
      });
      this.setState({ standbyCall: [] })
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

    if(this.state.isAuthenticated && this.state.timeType === 1500) {
      base.update(`users/${this.state.uid}`, {
        data: {
          state: true
        }
      });
    }
  }

  reset(resetFor = this.state.time) {
    clearInterval(this.interval);
    this.format(resetFor);
    this.setState({ play: false });

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
    // console.info(this.state);

    const clockStrokes = [];
    for(let i = 1; i < 61; i++) {
      clockStrokes.push(<div className="stroke" style={{ "transform": `rotate(${ i * 6 }deg)` }} key={ i }></div>);
    }

    return (
      <div id="pomodoro" className={ this.state.dashboard ? `dashboard-active` : `dashboard-inactive` }>
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
              <button className="btn-play" id="control-play" onClick={ this.play }>
                <i className="sr-only">Start</i>
              </button>
              <button className="btn-stop" id="control-stop" onClick={ this.reset }>
                <i className="sr-only">Pause</i>
              </button>
            </div>
          </div>
        </div>
        <div id="todo-now">
          <strong className="text">
            {
              this.state.todoList.length > 0
              ? `${this.state.todoList[0].title} 중`
              : `현재 진행중인 Task 없음`
            }
          </strong>
        </div>
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
              <i className="header-icon"></i>
              <h2 className="header-title">
                { this.state.dashboard ? '타이머로 돌아가기' : 'Dashboard' }
              </h2>
            </div>
            <div className="dashboard-tab" ref="dashboardTab">
              <button className="tab-item is-active" onClick={ this.switchTab }>Message</button>
              <button className="tab-item" onClick={ this.switchTab }>To-do</button>
              <button className="tab-item" onClick={ this.switchTab }>Members</button>
              <button className="tab-item" onClick={ this.switchTab }>Setting</button>
            </div>
            <div className="dashboard-container" ref="dashboardContainer">
              <div className="dashboard-content" id="dashboard-message">
                {
                  this.state.users && !!this.state.standbyCall.length ?
                  <ul>
                    {
                      this.state.standbyCall.map((item, index) => {
                        return (
                          <li key={ index }>
                            callerName: { this.state.users[item.caller].name }
                            message: { item.message }
                            send: { item.sendDate }
                          </li>
                        );
                      })
                    }
                  </ul>
                  : 'no standby call'
                }
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
                                        <strong className="title">{ item.title }</strong>
                                        { moment.unix(item.createDate).format('YYYY-MM-DD HH:MM') }
                                        <div className="todo-btn todo-btn-done">
                                          <FontAwesomeIcon
                                            icon={ faSquare }
                                            onClick={
                                              this.doneTodo.bind(this, index)
                                            }
                                          />
                                        </div>
                                        <div className="todo-btn todo-btn-delete">
                                          <FontAwesomeIcon
                                            icon={ faTrashAlt }
                                            onClick={
                                              this.deleteTodo.bind(this, index, 'todoList')
                                            }
                                          />
                                        </div>
                                        {/* <div className="todo-btn-area">
                                          <button className="todo-btn todo-btn-done" onClick={ this.doneTodo.bind(this, index) }>[V]</button>
                                          <button className="todo-btn todo-btn-close" onClick={ this.deleteTodo.bind(this, index) }>[X]</button>
                                        </div> */}
                                      </div>
                                      <div className="todo-btn todo-btn-grippy" { ...provided.dragHandleProps }>::</div>
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
                    <div
                      className="todo-btn-new"
                      onClick={(e) => {
                        let title = window.prompt();
                        title ? this.setState({ todoList: [...this.state.todoList, { title: title, createDate: moment().unix() }] }) : e.preventDefault();
                      }}
                    >
                      <FontAwesomeIcon icon={ faPlus } />
                    </div>
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
                              <strong className="title">{ item.title }</strong>
                              {/* { moment.unix(item.createDate).format('YYYY-MM-DD HH:MM') } */}
                              <div className="todo-btn todo-btn-done">
                                <FontAwesomeIcon
                                  icon={ faCheckSquare }
                                  onClick={
                                    this.resetTodo.bind(this, index)
                                  }
                                />
                              </div>
                              <div className="todo-btn todo-btn-delete">
                                <FontAwesomeIcon
                                  icon={ faTrashAlt }
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
              <div className="dashboard-content" id="dashboard-members">
                <ul className="members-list">
                  {
                    this.state.isAuthenticated && this.state.users && Object.keys(this.state.users).map((key, idx) => {
                      let data = this.state.users[key];
                      if(key === this.state.uid) return false;
                      if(key === 'null') return false;

                      return (
                        <li
                          className={ `member ${ data.online ? data.state ? 'is-active' : 'is-inactive' : 'is-offline' }` }
                          key={ idx }
                          data-uid={ key }
                        >
                          <div className="member-header">
                            <div className="thumbnail">
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
              <div className="dashboard-content" id="dashboard-setting">
                <ul className="setting-options">
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
                      <label htmlFor="notification" className="toggle" />
                    </div>
                  </li>
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
                        className={ `member ${ data.online ? data.state ? 'is-active' : 'is-inactive' : 'is-offline' }` }
                        key={ idx }
                        data-uid={ key }
                      >
                        <div className="thumbnail">
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
      //   <div className="pomodoro">
      //     <Helmet>
      //       <title>{this.state.title}</title>
      //     </Helmet>
      //     {/* Main section
      //     ------------------------------- */}
      //     {
      //       this.state.isAuthenticated && this.state.users &&
      //       [
      //         <div className="dashboard" key="dashboard">
      //           <div className={ `user-card is-own ${this.state.play ? 'is-active' : 'is-inactive'}` }>
      //             <div className="profile-pic-area">
      //               <img className="profile-pic" src={ this.state.picture } alt="" />
      //             </div>
      //             <div className="profile-info-area">
      //               <strong>
      //                 { this.state.name }
      //               </strong>
      //               <br />
      //               online - { this.state.timeType === 1500 && this.state.play ? 'active' : 'inactive' }
      //               <br />
      //               {
      //                 this.state.pomo[this.state.weekOfYear]
      //                 ? this.state.pomo[this.state.weekOfYear] + ' pomos this week'
      //                 : 'no pomos this week'
      //               }
      //               <button className="profile-tasks-btn" onClick={ this.viewTasks.bind(this, this.state.uid) }>view all tasks</button>
      //               {
      //                 this.state.viewTaskData && this.state.viewTaskData.uid === this.state.uid &&
      //                 this.state.viewTaskData.data.map((data, idx) => {
      //                   return (
      //                     <div style={{ backgroundColor: "#eee", margin: "4px 0", borderRadius: "4px" }}>
      //                       <strong>{ data.title }</strong>
      //                       <br />
      //                       create: { moment.unix(Number(data.createDate)).format("YYYY-MM-DD HH:mm:ss") }
      //                       <br />
      //                       done: { moment.unix(Number(data.doneDate)).format("YYYY-MM-DD HH:mm:ss") }
      //                     </div>
      //                   )
      //                 })
      //               }
      //             </div>
      //           </div>
      //           {
      //             this.state.users.map((data, idx) => {
      //               if(data.key === this.state.uid) return false;

      //               return (
      //                 <div
      //                   className={ `user-card ${ data.online ? data.state ? 'is-active' : 'is-inactive' : 'user-card is-offline' }` }
      //                   key={ idx }
      //                   data-uid={ data.key }
      //                 >
      //                   <div className="profile-pic-area">
      //                     <img className="profile-pic" src={ data.picture } alt="" />
      //                   </div>
      //                   <div className="profile-info-area">
      //                     <strong>
      //                       { data.name }
      //                     </strong>
      //                     <div>
      //                       { data.online ? 'online' : 'offline' } - { data.state ? 'active' : 'inactive' }
      //                     </div>
      //                     {
      //                       data.pomo && data.pomo[this.state.weekOfYear] && 
      //                       data.pomo[this.state.weekOfYear]
      //                       ? <div>{ data.pomo[this.state.weekOfYear] } pomos this week</div>
      //                       : <div>no pomos this week</div>
      //                     }
      //                     {
      //                       data.activeTodo
      //                       ? <div>current task: { data.activeTodo[0].title }</div>
      //                       : <span>no current task</span>
      //                     }
      //                     <button className="profile-tasks-btn" onClick={ this.viewTasks.bind(this, data.key) }>view all tasks</button>
      //                     {
      //                       this.state.viewTaskData && this.state.viewTaskData.uid === data.key &&
      //                       this.state.viewTaskData.data.map((data, idx) => {
      //                         return (
      //                           <div style={{ backgroundColor: "#eee", margin: "4px 0", borderRadius: "4px" }}>
      //                             <strong>{ data.title }</strong>
      //                             <br />
      //                             create: { moment.unix(Number(data.createDate)).format("YYYY-MM-DD HH:mm:ss") }
      //                             <br />
      //                             done: { moment.unix(Number(data.doneDate)).format("YYYY-MM-DD HH:mm:ss") }
      //                           </div>
      //                         )
      //                       })
      //                     }
      //                     {
      //                       data.online && <button className="profile-call-btn" onClick={ this.callUser.bind(this, data.key) }>Call</button>
      //                     }
      //                   </div>
      //                 </div>
      //               )
      //             })
      //           }
      //         </div>,
      //         <div className="todo" key="todo">
      //           <h3 className="todo-title">
      //             To-do
      //             {
      //               this.state.todoList.length < 5 &&
      //               <div
      //                 className="todo-btn-new"
      //                 onClick={(e) => {
      //                   let title = window.prompt();
      //                   title ? this.setState({ todoList: [...this.state.todoList, { title: title, createDate: moment().unix() }] }) : e.preventDefault();
      //                 }}
      //               >
      //                 <FontAwesomeIcon icon={ faPlus } />
      //               </div>
      //             }
      //           </h3>
      //           <DragDropContext onDragEnd={ this.todoOnDragEnd } key="todoDnd">
      //             <Droppable droppableId="droppable">
      //               {(provided, snapshot) => (
      //                 <div
      //                   ref={ provided.innerRef }
      //                   className="todo-list"
      //                 >
      //                   {
      //                     this.state.todoList.map((item, index) => (
      //                       <Draggable key={ index } draggableId={ index } index={ index }>
      //                         {(provided, snapshot) => (
      //                           <div
      //                             ref={ provided.innerRef }
      //                             { ...provided.draggableProps }
      //                             className="todo-item"
      //                           >
      //                             <div className="inner">
      //                               <strong>{ item.title }</strong>
      //                               { moment.unix(item.createDate).format('YYYY-MM-DD HH:MM') }
      //                               <div className="todo-btn-done">
      //                                 <FontAwesomeIcon
      //                                   icon={ faSquare }
      //                                   onClick={
      //                                     this.doneTodo.bind(this, index)
      //                                   }
      //                                 />
      //                               </div>
      //                               <div className="todo-btn-delete">
      //                                 <FontAwesomeIcon
      //                                   icon={ faTrashAlt }
      //                                   onClick={
      //                                     this.deleteTodo.bind(this, index, 'todoList')
      //                                   }
      //                                 />
      //                               </div>
      //                               {/* <div className="todo-btn-area">
      //                                 <button className="todo-btn todo-btn-done" onClick={ this.doneTodo.bind(this, index) }>[V]</button>
      //                                 <button className="todo-btn todo-btn-close" onClick={ this.deleteTodo.bind(this, index) }>[X]</button>
      //                               </div> */}
      //                             </div>
      //                             <div className="todo-btn todo-btn-grippy" { ...provided.dragHandleProps }>::</div>
      //                           </div>
      //                         )}
      //                       </Draggable>
      //                     ))
      //                   }
      //                   { provided.placeholder }
      //                 </div>
      //               )}
      //             </Droppable>
      //           </DragDropContext>
      //           {
      //             !!this.state.doneTodoList.length &&
      //             <div
      //               className="todo-list-completed"
      //             >
      //               <div
      //                 className="todo-btn-view-compl"
      //                 onClick={(e) => {
                        
      //                 }}
      //               >
      //                 { this.state.doneTodoList.length } completed items
      //               </div>
      //               <div className="todo-list">
      //                 {
      //                   this.state.doneTodoList.map((item, index) => (
      //                     <div className="todo-item" key={ index }>
      //                       <div className="inner">
      //                         <strong>{ item.title }</strong>
      //                         { moment.unix(item.createDate).format('YYYY-MM-DD HH:MM') }
      //                         <div className="todo-btn-done">
      //                           <FontAwesomeIcon
      //                             icon={ faCheckSquare }
      //                             onClick={
      //                               this.resetTodo.bind(this, index)
      //                             }
      //                           />
      //                         </div>
      //                         <div className="todo-btn-delete">
      //                           <FontAwesomeIcon
      //                             icon={ faTrashAlt }
      //                             onClick={
      //                               this.deleteTodo.bind(this, index, 'doneTodoList')
      //                             }
      //                           />
      //                         </div>
      //                       </div>
      //                     </div>
      //                   ))
      //                 }
      //               </div>
      //             </div>
      //           }
      //         </div>
      //       ]
      //     }
      //     <div className="main">

      //     <div className="container display timer">
      //       <span className="time">{this.format(this.state.time)}</span>
      //       <span className="timeType">The {this.formatType(this.state.timeType)} time!</span>
      //     </div>

      //     <div className="container display types">
      //       <button className="btn code" onClick={this.setTimeForCode}>Code</button>
      //       <button className="btn social" onClick={this.setTimeForSocial}>Social</button>
      //       <button className="btn coffee" onClick={this.setTimeForCoffee}>Coffee</button>
      //     </div>

      //     <div className="container">
      //       <div className="controlsPlay">
      //       <button className="play btnIcon" onClick={this.play}></button>
      //       <button className="stop btnIcon" onClick={this.reset}></button>
      //       </div>
      //     </div>

      //     </div> {/* main */}

      //     {/* Bottom section
      //     ------------------------------- */}
      //     <div className="bottomBar">

      //     <div className="controls">
      //         <div className="container">

      //           <div className="controlsCheck">

      //             {
      //               this.state.isAuthenticated
      //               ? this.state.name && <div className="welcome-msg"><div id="customBtn" className="customGPlusSignIn" onClick={() => this.auth('google')}><span className="icon"></span><span className="buttonText">SIGN OUT</span></div></div>
      //               : <div className="welcome-msg"><div id="customBtn" className="customGPlusSignIn" onClick={() => this.auth('google')}><span className="icon"></span><span className="buttonText">SIGN IN / SIGN UP</span></div></div>
      //             }

      //             <span className="check">
      //             <input 
      //               type="checkbox" 
      //               ref="notification" 
      //               id="notification"
      //               defaultChecked={this._getLocalStorage('notification')}
      //               onChange={this._setLocalStorage.bind(this, 'notification')} 
      //             />
      //             <label htmlFor="notification">
      //               <span className="checkIcon" />
      //               Notification
      //             </label>
      //             </span>

      //             <span className="check">
      //             <input 
      //               type="checkbox" 
      //               ref="audio" 
      //               id="audio"
      //               defaultChecked={this._getLocalStorage('audio')}
      //               onChange={this._setLocalStorage.bind(this, 'audio')} 
      //             />
      //             <label htmlFor="audio">
      //               <span className="checkIcon" />
      //               Sound
      //             </label>
      //             </span>

      //             {/* <span className="check">
      //             <input 
      //                 type="checkbox" 
      //                 ref="vibrate" 
      //                 id="vibrate"
      //                 defaultChecked={this._getLocalStorage('vibrate')}
      //                 onChange={this._setLocalStorage.bind(this, 'vibrate')} 
      //             />
      //             <label htmlFor="vibrate">
      //               <span className="checkIcon" />
      //               Vibration
      //             </label>
      //             </span> */}

      //           </div> {/* controlsCheck */}

      //         </div> {/* container */}
      //     </div> {/* controls */}

      //     {/* <Footer /> */}

      //     </div> {/* bottomBar */}
      // </div>
    )
  }
}

export default Pomodoro;