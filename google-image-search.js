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
    qs: { image_url: data.image_url, sbisrc: '4chanx', safe: 'off' },
    headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.90 Safari/537.36', 'accept-language': 'en-US,en;q=0.5' }
  };
  
  request.get(options, function(err, res, body) {
    json = {};
  
    if (err) {
      console.log('Image search error: ' + err);
      json = { response_type: 'ephemeral', text: t('something_went_wrong_when_looking_for_similar_images') };
    }
    else {
      const $ = cheerio.load(body);
      let name = $('#topstuff .card-section > div + div a').html();
      const result = 'https:' + $('.card-section > div img').attr('src');
      if (name && result) {
        const link = 'https://www.google.com/searchbyimage?site=search&sa=X&image_url=' + data.image_url;
        const entities = new Entities();
        name = entities.decode(name);
        console.log('Image search name: ' + name);
        console.log('Image search URL: ' + result);
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
        console.log('No results for image search');
        json = { response_type: 'ephemeral', text: t('no_image_search_results_found_now_-_please_try_again_later') };
      }
    }
  
    json.replace_original = false;
    json.delete_original = false;
    json.thread_ts = data.thread_ts;
    json.channel = data.channel.id;

    const query = qs.stringify(json);
    https.get('https://slack.com/api/chat.postMessage?' + query, { headers: { Authorization: 'Bearer ' + data.access_token } });
  
    callback(null);
  });
};