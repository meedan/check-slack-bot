// This function looks for similar images on Google and sends a message back to Slack

/*
 * data = {
 *   image_url,
 *   response_url,
 * }
 */

const config = require('./config.js'),
      request = require('request'),
      util = require('util'),
      qs = require('querystring'),
      https = require('https'),
      cheerio = require('cheerio'),
      Entities = require('html-entities').AllHtmlEntities;

const { t } = require('./helpers.js');

exports.handler = function(data, context, callback) {
  let options = {
    url: 'https://www.google.com/searchbyimage',
    qs: { image_url: data.image_url },
    headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux i686) AppleWebKit/537.11 (KHTML, like Gecko) Chrome/23.0.1271.64 Safari/537.11' }
  };
  
  request(options, function(err, res, body) {
    json = {};
  
    if (err) {
      json = { response_type: 'ephemeral', text: t('something_went_wrong_when_looking_for_similar_images') };
    }
    else {
      const $ = cheerio.load(body);
      let name = $('.fKDtNb').html();
      const result = 'https:' + $('.GMzDwb').attr('src');
      if (name && result) {
        const link = 'https://www.google.com/searchbyimage?site=search&sa=X&image_url=' + data.image_url;
        const entities = new Entities();
        name = entities.decode(name);
        json = {
          response_type: 'in_channel',
          attachments: JSON.stringify([
            {
              title: t('image_search_results'),
              title_link: link,
              fallback: t('image_search_results'),
              mrkdwn_in: ['title', 'text'],
              text: t('this_seems_to_be') + ' *' + name + '*. ' + t('i_found_this_similar_image_on_the_side') + '. <' + link + '|' + t('more_on_Google') + '>.',
              thumb_url: result
            }
          ])
        };
      }
      else {
        json = { response_type: 'ephemeral', text: t('no_image_search_results_found_now_-_please_try_again_later') };
      }
    }
  
    json.token = data.access_token;
    json.replace_original = false;
    json.delete_original = false;
    json.thread_ts = data.thread_ts;
    json.channel = data.channel.id;

    const query = qs.stringify(json);
    https.get('https://slack.com/api/chat.postMessage?' + query);
  
    callback(null);
  });
};
