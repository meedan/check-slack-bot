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
      cheerio = require('cheerio'),
      ACCESS_TOKEN = config.slack.accessToken;

const { t } = require('./helpers.js');

exports.handler = (data, context, callback) => {
  let options = {
    url: 'https://www.google.com/searchbyimage',
    qs: { image_url: data.image_url },
    headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux i686) AppleWebKit/537.11 (KHTML, like Gecko) Chrome/23.0.1271.64 Safari/537.11' }
  };
  
  request(options, function(err, res, body) {
    json = {};
  
    if (err) {
      json = { response_type: 'ephemeral', replace_original: false, delete_original: false, text: t('something_went_wrong') };
    }
    else {
      const $ = cheerio.load(body);
      const name = $('._gUb').html();
      const result = 'https:' + $('._u6').attr('src');
      if (name && result) {
        const link = 'https://www.google.com/searchbyimage?site=search&sa=X&image_url=' + data.image_url;
        json = {
          response_type: 'in_channel',
          replace_original: false,
          delete_original: false,
          attachments: [
            {
              title: t('image_search_results'),
              title_link: link,
              fallback: t('image_search_results'),
              mrkdwn_in: ['title', 'text'],
              text: t('this_seems_to_be') + ' *' + name + '*. ' + t('i_found_this_similar_image_on_the_side') + '. <' + link + '|' + t('more_on_Google') + '>.',
              thumb_url: result
            }
          ]
        };
      }
      else {
        json = { response_type: 'ephemeral', replace_original: false, delete_original: false, text: t('no_results_found_now-_try_again_later') };
      }
    }
  
    json.token = ACCESS_TOKEN;

    options = {
      uri: data.response_url,
      method: 'POST',
      json: json
    };
  
    request(options, function(err, res, body) {
      console.log('Output from delayed response: ' + body);
    });
    
    callback(null);
  });
};
