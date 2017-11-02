const config = require('./config.js'),
      redis = require('redis');

const t = function(str, capitalizeAll) {
  if (capitalizeAll) {
    return str.replace(/_/g, ' ').replace(/\w\S*/g, function(txt) { return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase(); });
  }
  str = str.replace(/_/g, ' ');
  return str.charAt(0).toUpperCase() + str.slice(1);
};

const formatMessageFromData = function(data) {
  var tags = [];
  data.tags.edges.forEach(function(tag) {
    tags.push(tag.node.tag);
  });

  var statusColor = '#ccc';
  var statusLabel = data.last_status;
  var statuses = JSON.parse(data.verification_statuses);
  var options = [];
  statuses.statuses.forEach(function(st) {
    if (st.id === data.last_status) {
      statusColor = st.style.color;
      statusLabel = st.label;
    }
    options.push({ text: t(st.label.toLowerCase().replace(/ /g, '_'), true), value: st.id });
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
          title: t('tasks_completed', true),
          value: data.tasks_count.completed + '/' + data.tasks_count.all,
          short: true
        },
        {
          title: t('added_to_check', true),
          value: '<!date^' + data.created_at + '^{date} {time}|' + data.created_at + '>',
          short: true
        },
        {
          title: t('last_update', true),
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
      author_name: data.user.name + ' | ' + t(data.author_role, true),
      author_icon: data.user.profile_image,
      image_url: data.metadata.picture,
      mrkdwn_in: ['title', 'text', 'fields'],
      fallback: data.metadata.permalink,
      callback_id: JSON.stringify({ last_status_id: data.last_status_obj.id, team_slug: data.team.slug, id: data.dbid, link: data.metadata.permalink }),
      response_type: 'in_channel',
      replace_original: false,
      delete_original: false,
      actions: [
        {
          name: 'change_status',
          text: t('change_status', true),
          type: 'select',
          style: 'primary',
          options: options
        },
        {
          name: 'add_comment',
          text: t('add_comment', true),
          type: 'button',
          style: 'primary'
        },
      ]
    }
  ];
};

const getRedisClient = function() {
  const client = redis.createClient({ host: config.redisHost });

  client.on('error', function(err) {
    console.log('Error when connecting to Redis: ' + err);
  });

  return client;
};

module.exports = {
  formatMessageFromData,
  t,
  getRedisClient,
};
