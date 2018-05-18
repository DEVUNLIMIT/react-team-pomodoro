import React from 'react';
// import { Link } from 'react-router-dom';

import Mousetrap from 'mousetrap';
import { Helmet } from 'react-helmet';

import moment from 'moment';

import './Pomodoro.scss';

import firebaseConf from './firebase.conf';
import * as firebase from 'firebase';

import Rebase from 're-base';

var base = Rebase.createClass(firebase.initializeApp({ ...firebaseConf }).database());

const dummyUserId = 'h44KLR70'

class Pomodoro extends React.Component {
    constructor() {
      super();
  
      this.state = {
          // OAuth
          isAuthenticated: false,
          token: 0,
          uid: 0,
          name: 0,

          // Pomodoro
          time: 0,
          play: false,
          timeType: 0,
          title: ''
      };

      // Bind early, avoid function creation on render loop
      this.setTimeForCode = this.setTime.bind(this, 1500);
      this.setTimeForSocial = this.setTime.bind(this, 300);
      this.setTimeForCoffee = this.setTime.bind(this, 900);
      this.reset = this.reset.bind(this);
      this.play = this.play.bind(this);
      this.elapseTime = this.elapseTime.bind(this);

      

      window.addEventListener('beforeunload', (e) => {
        base.update(`users/${dummyUserId}`, {
          data: {
            online: false
          }
        })
      });
    }

    componentWillUnmount() {
      //
    }

    componentWillMount() {

      let authSuccess = (token, user) => this.authSuccess(token, user);
      let authFailure = (errorCode, errorMessage, email, credential) => this.authFailure(errorCode, errorMessage, email, credential);

      firebase.auth().getRedirectResult().then(function(result) {
        if (result.credential) {
          // This gives you a Google Access Token. You can use it to access the Google API.
          var token = result.credential.accessToken;
          // ...
        }
        // The signed-in user info.
        var user = result.user;

        authSuccess(token, user);
      }).catch(function(error) {
        // Handle Errors here.
        var errorCode = error.code;
        var errorMessage = error.message;
        // The email of the user's account used.
        var email = error.email;
        // The firebase.auth.AuthCredential type that was used.
        var credential = error.credential;
        // ...

        authFailure(errorCode, errorMessage, email, credential);
      });

      base.update('users/h44KLR70', {
        data: {
          online: true
        }
      });
    }

    componentDidMount() {
      let currentWeekNo = moment().week();
      base.listenTo(`users/${dummyUserId}/pomoCount/2018/${currentWeekNo}`, {
        context: this,
        asArray: false,
        then(data){
          // console.log(data);
        }
      });

      this.setDefaultTime();
      this.startShortcuts();
      Notification.requestPermission();
    }

    auth(site) {
      if(site === 'google') {
        firebase.auth().useDeviceLanguage();
        firebase.auth().signInWithRedirect(new firebase.auth.GoogleAuthProvider());
      }
    }

    authSuccess(token, user) {
      this.setState({
        isAuthenticated: true,
        token: token,
        uid: user.uid,
        name: user.displayName
      });
    }

    authFailure(errorCode, errorMessage, email, credential) {
      
    }
  
    elapseTime() {
      if (this.state.time === 0) {
        this.reset(0);
        this.alert();
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
  
      this.restartInterval();
      
      this.setState({ 
        play: true 
      });
    }
  
    reset(resetFor = this.state.time) {
      clearInterval(this.interval);
      this.format(resetFor);
      this.setState({play: false});
    }
  
    togglePlay() {
      if (true === this.state.play) {
        return this.reset();
      }
  
      return this.play();
    }
  
    setTime(newTime) {
      this.restartInterval();
      
      this.setState({
        time: newTime, 
        timeType: newTime, 
        title: this.getTitle(newTime), 
        play: true
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
              <div className="main">

              <button type="button" style={{ position: 'absolute', top: '50%', right: '10%' }} onClick={() => this.auth('google')}>Google Auth { this.state.isAuthenticated ? 'true' : 'false' }</button>

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