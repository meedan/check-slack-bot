# Check Slack Bot

This is a Slack bot for Check. It should reply to message that contain one or more Check URLs and display a preview of it as a Slack message. It uses Slack's Events API and connects to a lambda function running on AWS.

## Usage

* Copy `config.js.example` to `config.js` and define your configurations
* Generate a ZIP package: `npm run build`
* [Follow these steps](https://api.slack.com/tutorials/aws-lambda) in order to create a AWS Lambda function + API endpoint (remember to deploy your API using AWS UI)
* [Follow these steps](https://api.slack.com/tutorials/events-api-using-aws-lambda) in order to setup your Slack app to use the Events API and to sent events to the lambda function created above, but instead of pasting the code that the tutorial shows, use the ZIP you created previously with `npm run build`
