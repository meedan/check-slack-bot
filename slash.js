// This function adds a ProjectMedia to Check and sends a message back to Slack

/*
 * data = {
 *   project_id,
 *   url,
 *   response_url,
 * }
 */

const config = require('./config.js'),
      request = require('request'),
      util = require('util'),
      qs = require('querystring'),
      aws = require('aws-sdk');

const { getCheckSlackUser, t, getTeamConfig } = require('./helpers.js');

const permissionError = function(callback) {
  callback(null, t('Sorry,_seems_that_you_do_not_have_the_permission_to_do_this._Please_go_to_the_app_and_login_by_your_Slack_user,_or_continue_directly_from_there') + ': ' + config.checkWeb.url );
};

const process = function(body, token, callback) {
  const setProjectRegexp = new RegExp(/set <(.+)>/, 'g');
  const showProjectRegexp = new RegExp(/show/, 'g');
  const addUrlRegexp = new RegExp(/<(.+)>/, 'g');

  let action = '';
  if (projectUrl = setProjectRegexp.exec(body.text)) {
    const projectRegexp = new RegExp(config.checkWeb.url + '/([^/]+)/project/([0-9]+)', 'g');
      if (matches = projectRegexp.exec(projectUrl[1])) {
        text = 'Setting project...';
        action = 'setProject';
      } else { text = 'Invalid project URL: ' + projectUrl[1]; }
  } else if (matches = showProjectRegexp.exec(body.text)) {
    text = 'Getting project...';
    action = 'showProject';
  } else if (matches = addUrlRegexp.exec(body.text)) {
    text = 'Sending URL to ' + config.appName + ': ' + matches[1];
    action = 'createProjectMedia';
  } else {
    text = '';
    action = 'showTips';
  };

  if (action != '') {
    const payload = { type: action, body: body, matches: matches, user_token: token }
    try {
      const lambda = new aws.Lambda({ region: config.awsRegion });
      lambdaRequest = lambda.invoke({ FunctionName: 'slash-response', InvocationType: 'Event', Payload: JSON.stringify(payload) });
      const lambdaReturn = lambdaRequest.send();
    } catch (e) {}
  };
  console.log(text);
  callback(null, text);
};

exports.handler = function(event, context, callback) {
  const body = qs.parse(decodeURIComponent(event.body));
  const teamConfig = getTeamConfig(body.team_id);
  if (body.token === teamConfig.verificationToken) {
    getCheckSlackUser(body.user_id,
      function(err) {
        console.log('Error when trying to identify Slack user: ' + util.inspect(err));
        permissionError(callback);
      },
      function(token) {
        console.log('Successfully identified as Slack user with token: ' + token);
        process(body, token, callback);
    });
  } else {
    console.log('Invalid request token: ' + body.token);
    permissionError(callback);
  }
};
