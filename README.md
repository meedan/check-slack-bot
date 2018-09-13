# Check Slack Bot

[![Test Coverage](https://api.codeclimate.com/v1/badges/7af7ca1a231b34837ab4/test_coverage)](https://codeclimate.com/github/meedan/check-bot/test_coverage) [![Build Status](https://travis-ci.org/meedan/check-bot.svg?branch=develop)](https://travis-ci.org/meedan/check-bot)

This is a Slack bot for Check. It should reply to messages that contain one or more Check URLs and display a preview of it as a Slack message, with interaction buttons.

[These](https://www.youtube.com/watch?v=3v6asqguGIc) [awesome](https://www.youtube.com/watch?v=0foyYpTZrV4) [videos](https://www.youtube.com/watch?v=28IimNrjhwg) [here](https://www.youtube.com/watch?v=BzzBJALt8AY) show how it works.

## Diagram

The diagram below shows the architecture for this bot (a serverless structure on AWS), where each component is numbered with a white circle. The yellow circles show how it works. More details on the sections below.

![Diagram](diagram.png?raw=true "Diagram")

## Installation on AWS

The steps below reference the **white** circles on the diagram above.

* On AWS side, we need to create a VPC that allows our Lambda functions to connect to a Redis instance running privately on AWS but that should be also able to connect to Check, which is running outside AWS. AWS only allows you to assign Lambda functions to at least two subnets on a VPC and those subnets can't be connected to the internet directly, they need to be connected to a NAT. So, in order to attend all those requirements, we suggest the VPC setup numbered **[0]** on the diagram above: a network `10.0.0.0/16` with four subnets: a public one, labelled `A`, with range `10.0.0.0/18`, which is connected directly to an Internet Gateway; and three private subnets, labelled `B`, `C` and `D`, with ranges `10.0.64.0/18`, `10.0.128.0/18` and `10.0.192.0/18`. Those three private subnets should be connected to a `NAT` located at the public subnet `A`.
* Spin up a Redis instance running on AWS Elasticache **[1]**. This instance should use only the private subnets `B`, `C` and `D`. Copy the host to `config.js`.
* Back to your computer, copy `config.js.example` to `config.js` and define your configurations
* Copy `aws.json.example` to `aws.json` and add your AWS credentials
* Install the dependencies with `npm i` and generate a ZIP package with `npm run build`
* The same `./dist/aws_lambda_functions.zip` file that was generated should be uploaded to five lambda functions **[2]**. The following sections explain how those five functions should be created.
* Create a Lambda function called `check-slack-bot`, whose handler is `index.handler`. It should use subnets `B`, `C` and `D`. **[3]**
* Add a trigger to this Lambda function, of type "API Gateway". The API should have a single endpoint, that accepts only `POST` requests. Remember to deploy your API once done. **[4]**
* Create a Lambda function called `check-slack-bot-buttons`, whose handler is `buttons.handler`. It should use subnets `B`, `C` and `D`. **[5]**
* Add a trigger to this Lambda function, of type "API Gateway". The API should have a single endpoint, that accepts only `POST` requests. By default, the AWS API Gateway only accepts `application/json` requests, but Slack is going to send `application/x-www-form-urlencoded` requests when a message button is clicked. So, add a `Body Mapping Template` to your API `POST` method for the content type `application/x-www-form-urlencoded`. The contents of the template should be `{ "body": "$input.body" }`. Also, under the "Binary Support" section, add `application/x-www-form-urlencoded` as a content type to be considered binary input. Remember to deploy your API once all those things are done. **[6]**
* Create a Lambda function called `google-image-search`, whose handler is `google-image-search.handler` **[7]**
* Create a Lambda function called `check-slack-bot-slash`, whose handler is `slash.handler`. It should use subnets `B`, `C` and `D`. **[8]**
* Add a trigger to this Lambda function, of type "API Gateway". The API should have a single endpoint, that accepts only `POST` requests. **[9]**
  * `Integration Request`: By default, the AWS API Gateway only accepts `application/json` requests, but Slack is going to send `application/x-www-form-urlencoded` requests when a message button is clicked. So, add a `Mapping Template` to your API `POST` method for the content type `application/x-www-form-urlencoded`. The contents of the template should be `{ "body": "$input.body" }`. Also, under the "Binary Support" section, add `application/x-www-form-urlencoded` as a content type to be considered binary input.
  * `Integration Response`: The template configuration for `200` status will cause the slash command to display to the user `null` as response when the function returns no message (`help` command, for example). To avoid this, need to define a mapping template that returns the message when there is a message and will return nothing if the message is blank. So, add a `Mapping Template` for the content type `application/json`. The content of the template should be `#if($input.path('$') != '')$input.path('$')#end`.
  * Remember to deploy your API once all those things are done.
* Create a Lambda function called `slash-response`, whose handler is `slash-response.handler`. It should use subnets `B`, `C` and `D`. **[10]**
* Now on the Slack app side **[11]**, you need to do a few things:
  * On "Basic Information", copy the verification token to `config.js`, as `slack.verificationToken`
  * On "Interactive Components", put in the "Request URL" field the HTTP path to your `check-slack-bot-buttons` function
  * On "OAuth & Permissions", copy the "OAuth Access Token" to `config.js` as `slack.accessToken`, and add the following scopes: `channels.history`, `chat:write:bot` and `chat:write:user`
  * On "Event Subscriptions", enable events, put in the "Request URL" field the HTTP path to your `check-slack-bot` function and subscribe to the workspace event `message.channels`
  * On "Bot Users", add a new bot called Check
  * On "Basic Information" => "Add features and functionality", click on "Slash Commands" and create a new command. On `Command` add the name that will be called (`check` or `bridge`). Put in "Request URL" field the HTTP path to your `check-slack-bot-slash` function. The function needs to recognize URL, so check the option "Escape channels, users, and links sent to your app". Save the changes
* Finally, at the Check side **[12]**, create a new global API key and add to `config.js` as `checkApi.apiKey`.

Now that everything should be running smoothly, let's use it.

## Usage

The steps below reference the **yellow** circles on the diagram above.

* **[0]** The Check Slack Bot relies on Slack's Events API. So, when a new message is posted on a public channel, Slack makes a request to the `check-slack-bot` lambda function. If the message contains one or more Check media URLs, it will be parsed.
* **[1]** The lambda function makes a GraphQL request to Check API using the global token, asking for information about that media
* **[2]** The lambda function returns to Slack a formatted message with information about that media and also interaction buttons
  * That message that is created by the bot is also sent back to the bot (as any other message) **[0]**, which is going to send a mutation to Check **[1]** in order to create a `slack_message` annotation for that report. This annotation contains the Slack message id, this way Check is able to update that message and thread when actions happen on Check side.
* **[3]** When an interactive button is clicked, the action is sent to lambda function `check-slack-bot-buttons`. Today there are five possible actions:
  * If it's a "add comment", "add translation" (only for Bridge), "edit description" or "edit title" action, the function will save on Redis that action and the relation between that Slack message and the media **[4]**, and reply on Slack in a new thread **[5]**
    * When the user adds a message under that thread that was created by the bot, this message is going to be sent by Slack **[0]** to the `check-slack-bot` function which is going to verify on Redis **[6]** if that thread is related to any Check media. If so, it's going to first verify if that Slack user is related to any Check user. It does so by making an API call to Check **[1]** asking for the Check token of a user with that Slack UID. If there is such user, the bot uses that token to send a mutation to Check API **[1]** to add a new comment, add a new translation (only for Bridge), edit the description or edit the title. After the mutation completes, the bot sends a new message on the same thread to tell that the operation was done and also updates the existing message on Slack with the new title or new description **[2]**.
  * If it's a "change status" action, the bot asks Check API for the token of a Check user related to that Slack user **[7]**. If there is such user, the bot uses that token to send a mutation to Check API **[7]** to change the status of that media. After the mutation completes, the existing Slack message is updated with the new status **[5]**.
  * If it's a "image search" action, the bot asks Check API for the token of a Check user related to that Slack user **[7]**. If there is such user, the bot replies immediately to Slack **[5]** (because Slack only waits until 3s for an interactive button response) and, at same time, makes an asynchronous request to the `google-image-search` function, using AWS SDK **[8]**. That function will look for similar images on Google an send a message to Slack with the results **[9]**.
* **[10]** When a comment is created from Check UI or when a translation is created from Bridge UI or when a report status, title or description is changed from Check UI, Check sends a request to Slack in order to add a new message to a thread or to update an existing Slack message, respectively. This is done _only_ if the report on Check has at least one `slack_message` annotation, which connects a Check report to a Slack message id.


* **[11]** The Slash command let users trigger an interaction with your app directly from the message box in Slack. So, when a user posts the command defined (`check` or `bridge`), Slack makes a request to the `check-slack-bot-slash` lambda function and replies immediately to confirm the receipt.
The function verify the text sent and calls the function `slash-response` if the team token is valid and the Slack user is registered on Check.
* **[12]** If the message contains `set [project url]` the lambda function makes a GraphQL request to Check API using the global token, asking for information about the project. If the project is valid, the function will save on Redis the channel and the project and reply on Slack a success message **[13]**
* If the message contains `show` the lambda function verify on Redis **[14]** if that channel is related to any Check project. If so, reply on Slack the project url that is defined for the channel **[13]**
* If the message contains `[URL]`, the lambda function verify on Redis **[14]** if that channel is related to any Check project. If so, the funcion uses the user token to send a mutation to Check API and create a project media **[15]**. After the mutation completes, reply on Slack a message with the project media url **[13]**
* If the message contains an empty string or a text that is not recognized, the lambda function reply on Slack a message with the list of available commands **[13]**

## Tests

In order to run the tests, just run `npm test`.
