import React from 'react';
// import { Link } from 'react-router-dom';

import Mousetrap from 'mousetrap';
import { Helmet } from 'react-helmet';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';

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
        uid: null,
        name: null,
        picture: null,
        pomo: 0,

        standbyCall: [],
        calledUser: [],

        // Pomodoro
        weekOfYear: moment().week(),
        time: 0,
        play: false,
        timeType: 0,
        title: '',

        // To-do
        todoList: []
    };

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
                    base.remove(`calls/${callData.key}`, (err) => {
                      if(err) console.error(err);
                    });
                    
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
            // console.log('받은 호출', data);
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
          console.info('is new user');
          this.addNewUser(user);
        } else {
          console.info('is not new user');
          base.update(`users/${user.uid}`, {
            data: {
              online: true,
              state: false
            }
          });
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
    base.syncState('users', {
      context: this,
      state: 'users',
      asArray: true
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
          : alert('no data')
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
            callerName: this.state.name,
            caller: this.state.uid,
            callee: calleeId,
            message: message
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
    if(window.confirm('Are you sure you want to done?')) {
      let todo = this.state.todoList[index];
      let arr = [...this.state.todoList];
      arr.splice(index, 1);
      this.setState({ todoList: arr });

      base.push(`/users/${ this.state.uid }/doneTodo`, {
        data: {
          title: todo.title,
          createDate: todo.createDate,
          doneDate: moment().unix()
        }
      });

    } else {
      return false;
    }
  }

  deleteTodo(index) {
    if(window.confirm('Are you sure you want to delete?')) {
      let arr = [...this.state.todoList];
      arr.splice(index, 1);
      this.setState({ todoList: arr });
    } else {
      return false;
    }
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
            base.remove(`calls/${callData.key}`, (err) => {
              if(err) console.error(err);
            });
            
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
      this.setState({time: newState, title: this.getTitle(newState)});
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
    this.setState({play: false});

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
    if(this.refs.vibrate.checked) {
      window.navigator.vibrate(1000);
    }
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
    return (
        <div className="pomodoro">
          <Helmet>
            <title>{this.state.title}</title>
          </Helmet>
          {/* Main section
          ------------------------------- */}
          {
            this.state.isAuthenticated && this.state.users &&
            [
              <div className="dashboard" key="dashboard">
                <div className={ `user-card is-own ${this.state.play ? 'is-active' : 'is-inactive'}` }>
                  <div className="profile-pic-area">
                    <img className="profile-pic" src={ this.state.picture } alt="" />
                  </div>
                  <div className="profile-info-area">
                    <strong>
                      { this.state.name }
                    </strong>
                    <br />
                    online - { this.state.timeType === 1500 && this.state.play ? 'active' : 'inactive' }
                    <br />
                    {
                      this.state.pomo[this.state.weekOfYear]
                      ? this.state.pomo[this.state.weekOfYear] + ' pomos this week'
                      : 'no pomos this week'
                    }
                    <button className="profile-tasks-btn" onClick={ this.viewTasks.bind(this, this.state.uid) }>view all tasks</button>
                    {
                      this.state.viewTaskData && this.state.viewTaskData.uid === this.state.uid &&
                      this.state.viewTaskData.data.map((data, idx) => {
                        return (
                          <div style={{ backgroundColor: "#eee", margin: "4px 0", borderRadius: "4px" }}>
                            <strong>{ data.title }</strong>
                            <br />
                            create: { moment.unix(Number(data.createDate)).format("YYYY-MM-DD HH:mm:ss") }
                            <br />
                            done: { moment.unix(Number(data.doneDate)).format("YYYY-MM-DD HH:mm:ss") }
                          </div>
                        )
                      })
                    }
                  </div>
                </div>
                {
                  this.state.users.map((data, idx) => {
                    if(data.key === this.state.uid) return false;

                    return (
                      <div
                        className={ `user-card ${ data.online ? data.state ? 'is-active' : 'is-inactive' : 'user-card is-offline' }` }
                        key={ idx }
                        data-uid={ data.key }
                      >
                        <div className="profile-pic-area">
                          <img className="profile-pic" src={ data.picture } alt="" />
                        </div>
                        <div className="profile-info-area">
                          <strong>
                            { data.name }
                          </strong>
                          <div>
                            { data.online ? 'online' : 'offline' } - { data.state ? 'active' : 'inactive' }
                          </div>
                          {
                            data.pomo && data.pomo[this.state.weekOfYear] && 
                            data.pomo[this.state.weekOfYear]
                            ? <div>{ data.pomo[this.state.weekOfYear] } pomos this week</div>
                            : <div>no pomos this week</div>
                          }
                          {
                            data.activeTodo
                            ? <div>current task: { data.activeTodo[0].title }</div>
                            : <span>no current task</span>
                          }
                          <button className="profile-tasks-btn" onClick={ this.viewTasks.bind(this, data.key) }>view all tasks</button>
                          {
                            this.state.viewTaskData && this.state.viewTaskData.uid === data.key &&
                            this.state.viewTaskData.data.map((data, idx) => {
                              return (
                                <div style={{ backgroundColor: "#eee", margin: "4px 0", borderRadius: "4px" }}>
                                  <strong>{ data.title }</strong>
                                  <br />
                                  create: { moment.unix(Number(data.createDate)).format("YYYY-MM-DD HH:mm:ss") }
                                  <br />
                                  done: { moment.unix(Number(data.doneDate)).format("YYYY-MM-DD HH:mm:ss") }
                                </div>
                              )
                            })
                          }
                          {
                            data.online && <button className="profile-call-btn" onClick={ this.callUser.bind(this, data.key) }>Call</button>
                          }
                        </div>
                      </div>
                    )
                  })
                }
              </div>,
              <div className="todo" key="todo">
                <h3 className="todo-title">
                  To-do
                </h3>
                <DragDropContext onDragEnd={ this.todoOnDragEnd } key="todo2">
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
                                  { item.title }
                                  <div className="todo-btn-area">
                                    <button className="todo-btn todo-btn-done" onClick={ this.doneTodo.bind(this, index) }>[V]</button>
                                    <button className="todo-btn todo-btn-close" onClick={ this.deleteTodo.bind(this, index) }>[X]</button>
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
                {
                  this.state.todoList.length < 5 &&
                  <div
                    className="todo-btn-new"
                    onClick={(e) => {
                      let title = window.prompt();
                      title ? this.setState({ todoList: [...this.state.todoList, { title: title, createDate: moment().unix() }] }) : e.preventDefault();
                    }}
                  >
                    + New
                  </div>
                }
              </div>
            ]
          }
          <div className="main">

          <div className="container display timer">
              <span className="time">{this.format(this.state.time)}</span>
              <span className="timeType">The {this.formatType(this.state.timeType)} time!</span>
          </div>

          <div className="container display types">
              <button className="btn code" onClick={this.setTimeForCode}>Code</button>
              <button className="btn social" onClick={this.setTimeForSocial}>Social</button>
              <button className="btn coffee" onClick={this.setTimeForCoffee}>Coffee</button>
          </div>

          <div className="container">
              <div className="controlsPlay">
              <button className="play btnIcon" onClick={this.play}></button>
              <button className="stop btnIcon" onClick={this.reset}></button>
              </div>
          </div>

          </div> {/* main */}

          {/* Bottom section
          ------------------------------- */}
          <div className="bottomBar">

          <div className="controls">
              <div className="container">

              <div className="controlsCheck">

                  {
                    this.state.isAuthenticated
                    ? this.state.name && <div className="welcome-msg"><div id="customBtn" className="customGPlusSignIn" onClick={() => this.auth('google')}><span className="icon"></span><span className="buttonText">SIGN OUT</span></div></div>
                    : <div className="welcome-msg"><div id="customBtn" className="customGPlusSignIn" onClick={() => this.auth('google')}><span className="icon"></span><span className="buttonText">SIGN IN / SIGN UP</span></div></div>
                  }

                  <span className="check">
                  <input 
                      type="checkbox" 
                      ref="notification" 
                      id="notification"
                      defaultChecked={this._getLocalStorage('notification')}
                      onChange={this._setLocalStorage.bind(this, 'notification')} 
                  />
                  <label htmlFor="notification">
                    <span className="checkIcon" />
                    Notification
                  </label>
                  </span>

                  <span className="check">
                  <input 
                      type="checkbox" 
                      ref="audio" 
                      id="audio"
                      defaultChecked={this._getLocalStorage('audio')}
                      onChange={this._setLocalStorage.bind(this, 'audio')} 
                  />
                  <label htmlFor="audio">
                    <span className="checkIcon" />
                    Sound
                  </label>
                  </span>

                  <span className="check">
                  <input 
                      type="checkbox" 
                      ref="vibrate" 
                      id="vibrate"
                      defaultChecked={this._getLocalStorage('vibrate')}
                      onChange={this._setLocalStorage.bind(this, 'vibrate')} 
                  />
                  <label htmlFor="vibrate">
                    <span className="checkIcon" />
                    Vibration
                  </label>
                  </span>

              </div> {/* controlsCheck */}

              </div> {/* container */}
          </div> {/* controls */}

          {/* <Footer /> */}

          </div> {/* bottomBar */}

      </div>
    )
  }
}

export default Pomodoro;