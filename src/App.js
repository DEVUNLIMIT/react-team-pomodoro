import React from 'react';
import { BrowserRouter, Switch, Route } from 'react-router-dom';

import { Pomodoro, NotFound } from './routes';

import 'normalize.css';
import './App.scss';

const App = () => (
  <BrowserRouter>
    <Switch>
      <Route exact path="/" component={ Pomodoro } />
      <Route component={ NotFound } />
    </Switch>
  </BrowserRouter>
);

export default App;