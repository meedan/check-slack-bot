# Check Slack Bot

This is a Slack bot for Check. It should reply to message that contain one or more Check URLs and display a preview of it as a Slack message. It uses Slack's Events API and connects to a lambda function running on AWS.

## Usage

* Copy `config.js.example` to `config.js` and define your configurations
* Copy `aws.json.example` to `aws.json` and add your AWS credentials
* Generate a ZIP package: `npm run build`
* [Follow these steps](https://api.slack.com/tutorials/aws-lambda) in order to create a AWS Lambda function + API endpoint (remember to deploy your API using AWS UI)
* [Follow these steps](https://api.slack.com/tutorials/events-api-using-aws-lambda) in order to setup your Slack app to use the Events API and to sent events to the lambda function created above, but instead of pasting the code that the tutorial shows, use the ZIP you created previously with `npm run build`
* Create another AWS Lambda function to receive the buttons actions... the related API Gateway must have a "Body Mapping Template" for content type `application/x-www-form-urlencoded` with the following contents: `{ "body": "$input.body" }`
* Add the URL of this second lambda function in the "Request URL" field of the "Interactive Components" section of your Slack app
* Create a AWS Lambda function for the `google-image-search`
