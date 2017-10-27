const config = require('./config.js'),
      https = require('https'),
      qs = require('querystring'),
      os = require('os'),
      Lokka = require('lokka').Lokka,
      Transport = require('lokka-transport-http').Transport,
      util = require('util'),
      VERIFICATION_TOKEN = config.slack.verificationToken,
      ACCESS_TOKEN = config.slack.accessToken;

var handleErrors = function(errors, data) {
  console.log('ERROR: ' + util.inspect(errors));
};

var t = function(str) {
  return str.replace(/_/g, ' ').replace(/\w\S*/g, function(txt) { return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase(); });
};

var formatMessageFromData = function(data) {
  var tags = [];
  data.tags.edges.forEach(function(tag) {
    tags.push(tag.node.tag);
  });

  var statusColor = '#ccc';
  var statusLabel = data.last_status;
  var statuses = JSON.parse(data.verification_statuses);
  statuses.statuses.forEach(function(st) {
    if (st.id === data.last_status) {
      statusColor = st.style.color;
      statusLabel = st.label;
    }
  });

  return [
    {
      title: t(statusLabel.toLowerCase().replace(/ /g, '_')).toUpperCase() + ': ' + data.metadata.title,
      title_link: data.metadata.permalink,
      text: data.metadata.description,
      color: statusColor,
      fields: [
        {
          title: t('notes'),
          value: data.log_count,
          short: true
        },
        {
          title: t('tasks_completed'),
          value: data.tasks_count.completed + '/' + data.tasks_count.all,
          short: true
        },
        {
          title: t('added_to_check'),
          value: '<!date^' + data.created_at + '^{date} {time}|' + data.created_at + '>',
          short: true
        },
        {
          title: t('last_update'),
          value: '<!date^' + data.updated_at + '^{date} {time}|' + data.updated_at + '>',
          short: true
        },
        {
          title: t('tags'),
          value: tags.join(', '),
          short: true
        },
        {
          title: t('project'),
          value: data.project.title,
          short: true
        },
      ],
      author_name: data.user.name + ' | ' + t(data.author_role),
      author_icon: data.user.profile_image,
      image_url: data.metadata.picture,
      mrkdwn_in: ['title', 'text', 'fields']
    }
  ];
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
      console.log('DEBUG: Asked for project media and response was: ' + util.inspect(resp));
      var pm = resp.project_media;
      pm.metadata = JSON.parse(pm.metadata);
      callback(pm);
    }
  })
  .catch((e) => {
    console.log('ERROR: ' + e.toString());
  });
};

function verify(data, callback) {
  if (data.token === VERIFICATION_TOKEN) callback(null, data.challenge);
  else callback("verification failed");   
}

function process(event, callback) {
  const mainRegexp = new RegExp(config.checkApi.url, 'g');
  if (!event.bot_id && mainRegexp.test(event.text)) {
    const regexp = new RegExp(config.checkApi.url + '/([^/]+)/project/([0-9]+)/media/([0-9]+)', 'g');

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
    case "url_verification": verify(data, callback); break;
    case "event_callback": process(data.event, callback); break;
    default: callback(null);
  }
};
