const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const util = require('util');

const app = express();
const port = process.env.SERVER_PORT || 8585;
const functions = ['index', 'buttons', 'google-image-search', 'slash', 'slash-response'];

function generateCallback(response) {
  const callback = function(value, resp) {
    console.log('Callback: ' + util.inspect(value));
    if (resp) {
      response.send(resp);
    }
  };
  return callback;
}

app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

functions.forEach(function(name) {
  app.post('/' + name, function(request, response){
    const lambda = require('./' + name).handler;
    const data = request.body;
    const headers = request.headers;
    if (headers['x-slack-retry-num'] && headers['x-slack-retry-reason'] === 'http_timeout') {
      // Ignore
    }
    else {
      console.log(util.inspect(headers));
      console.log(util.inspect(data));
      lambda({ body: data, headers }, { source: 'local' }, generateCallback(response));
      console.log('--------------------------------------------------------------------------------------');
    }
  });
});

console.log('Starting server on port ' + port);
app.listen(port);
