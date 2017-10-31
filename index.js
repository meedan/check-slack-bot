const config = require('./config.js'),
      https = require('https'),
      qs = require('querystring'),
      os = require('os'),
      Lokka = require('lokka').Lokka,
      Transport = require('lokka-transport-http').Transport,
      util = require('util'),
      header = require('basic-auth-header'),
      VERIFICATION_TOKEN = config.slack.verificationToken,
      ACCESS_TOKEN = config.slack.accessToken;
      
const { formatMessageFromData, t } = require('./helpers.js');

var handleErrors = function(errors, data) {
  console.log('ERROR: ' + util.inspect(errors));
};

var getProjectMedia = function(teamSlug, projectId, projectMediaId, callback) {
  var headers = {
    'X-Check-Token': config.checkApi.apiKey
  };

  if (config.checkApi.httpAuth) {
    var credentials = config.checkApi.httpAuth.split(':');
    var basic = header(credentials[0], credentials[1]);
    headers['Authorization'] = basic;
  }

  const transport = new Transport(config.checkApi.url + '/api/graphql?team=' + teamSlug, { handleErrors, headers, credentials: false, timeout: 120000 });
  const client = new Lokka({ transport });

  const projectMediaQuery = `
  query project_media($ids: String!) {
    project_media(ids: $ids) {
      metadata
      last_status
      last_status_obj {
        id
      }
      log_count
      created_at
      updated_at
      tasks_count
      project {
        title
      }
      tags {
        edges {
          node {
            tag
          }
        }
      }
      author_role
      user {
        name
        profile_image
      }
      verification_statuses
    }
  }
  `;

  client.query(projectMediaQuery, { ids: projectMediaId + ',' + projectId })
  .then((resp, errors) => {
    if (errors) {
      console.log('ERROR: ' + util.inspect(errors));
    }
    else {
      console.log('DEBUG: Asked for project media and got response: ' + util.inspect(resp));
      var pm = resp.project_media;
      pm.metadata = JSON.parse(pm.metadata);
      pm.team = { slug: teamSlug };
      callback(pm);
    }
  })
  .catch((e) => {
    console.log('ERROR: ' + e.toString());
  });
};

function verify(data, callback) {
  if (data.token === VERIFICATION_TOKEN) callback(null, data.challenge);
  else callback(t('verification_failed'));   
}

function process(event, callback) {
  console.log('Request: ' + util.inspect(event));
  const mainRegexp = new RegExp(config.checkWeb.url, 'g');
  if (!event.bot_id && mainRegexp.test(event.text)) {
    const regexp = new RegExp(config.checkWeb.url + '/([^/]+)/project/([0-9]+)/media/([0-9]+)', 'g');

    while (matches = regexp.exec(event.text)) {

      var teamSlug = matches[1],
          projectId = matches[2],
          projectMediaId = matches[3];

      getProjectMedia(teamSlug, projectId, projectMediaId, function(data) {
        var message = { 
          token: ACCESS_TOKEN,
          channel: event.channel,
          attachments: JSON.stringify(formatMessageFromData(data))
        };

        var query = qs.stringify(message);
        https.get('https://slack.com/api/chat.postMessage?' + query);
      });
    }
  }

  callback(null);
}

exports.handler = (data, context, callback) => {
  switch (data.type) {
    case 'url_verification': verify(data, callback); break;
    case 'event_callback': process(data.event, callback); break;
    default: callback(null);
  }
};
