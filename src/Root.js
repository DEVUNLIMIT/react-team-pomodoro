import React from 'react';
// import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
// import store from './store';

import 'normalize.css';
import './Root.scss';

import App from './components/App';

const Root = () => (
  // <Provider store={store}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  // </Provider>
);

export default Root;