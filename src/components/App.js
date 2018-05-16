import React from 'react';
import { Switch, Route } from 'react-router-dom';

import { Pomodoro, NotFound } from './pages';

const App = () => (
  <Switch>
    <Route exact path="/" component={Pomodoro} />
    <Route component={NotFound} />
  </Switch>
);

export default App;