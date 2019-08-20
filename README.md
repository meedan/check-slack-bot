# Check Slack Bot

[![Test Coverage](https://api.codeclimate.com/v1/badges/7af7ca1a231b34837ab4/test_coverage)](https://codeclimate.com/github/meedan/check-bot/test_coverage) [![Build Status](https://travis-ci.org/meedan/check-bot.svg?branch=develop)](https://travis-ci.org/meedan/check-bot)

This is a Slack bot for Check. It should reply to messages that contain one or more Check URLs and display a preview of it as a Slack message, with interaction buttons.

## Demos

* https://www.youtube.com/watch?v=3v6asqguGIc
* https://www.youtube.com/watch?v=0foyYpTZrV4
* https://www.youtube.com/watch?v=28IimNrjhwg
* https://www.youtube.com/watch?v=BzzBJALt8AY
* https://www.youtube.com/watch?v=MFEY3ynvVJg

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
* Add a trigger to this Lambda function, of type "API Gateway". The API should have a single endpoint, that accepts only `POST` requests. **[4]**
* Add a `Mapping Template` to your API `POST` method for the content type `application/json`. The contents of the template should be:
```
{
  "body" : $input.json('$'),
  "headers": {
    #foreach($param in $input.params().header.keySet())
      "$param": "$util.escapeJavaScript($input.params().header.get($param))" #if($foreach.hasNext),#end         
    #end
  }
}
```
* Remember to re-deploy the API after that. **[4]**
* Create a Lambda function called `check-slack-bot-buttons`, whose handler is `buttons.handler`. It should use subnets `B`, `C` and `D`. **[5]**
* Add a trigger to this Lambda function, of type "API Gateway". The API should have a single endpoint, that accepts only `POST` requests. By default, the AWS API Gateway only accepts `application/json` requests, but Slack is going to send `application/x-www-form-urlencoded` requests when a message button is clicked. So, add a `Body Mapping Template` to your API `POST` method for the content type `application/x-www-form-urlencoded`. The contents of the template should be `{ "body": "$input.body" }`. Also, under the "Binary Support" section, add `application/x-www-form-urlencoded` as a content type to be considered binary input. Remember to deploy your API once all those things are done. **[6]**
* Create a Lambda function called `google-image-search`, whose handler is `google-image-search.handler` **[7]**
* Create a Lambda function called `check-slack-bot-slash`, whose handler is `slash.handler`. It should use subnets `B`, `C` and `D`. **[10]**
* Add a trigger to this Lambda function, of type "API Gateway". The API should have a single endpoint, that accepts only `POST` requests. Add a `Mapping Template` to your API `POST` method for the content type `application/json`. The contents of the template should be `#if($input.path('$') != '')$input.path('$')#end`. Remember to re-deploy the API after that. **[11]**
* Create a Lambda function called `slash-response`, whose handler is `slash-response.handler`. It should use subnets `B`, `C` and `D`. **[12]**
* On the Slack side **[8]** you need to:
  * Create a regular user to "act" like the bot, login as that user and generate a legacy token at https://api.slack.com/custom-integrations/legacy-tokens. Then copy the token to `config.js` as the `legacyToken`
  * Take a look at the bot identifier of the Smooch app, it should be `BKSBSQXP1`. Add it to `config.js` as the `smoochBotId`.
* Now on the Slack app side **[8]**, you need to do a few things:
  * On "Basic Information", copy the verification token to `config.js`, as `slack.verificationToken`
  * On "Interactive Components", put in the "Request URL" field the HTTP path to your `check-slack-bot-buttons` function
  * On "OAuth & Permissions", copy the "OAuth Access Token" to `config.js` as `slack.accessToken`, and add the following scopes: `channels.history`, `chat:write:bot` and `chat:write:user`
  * On "Event Subscriptions", enable events, put in the "Request URL" field the HTTP path to your `check-slack-bot` function and subscribe to the workspace events `message.channels` and `channel.archive`
  * On "Bot Users", add a new bot called Check
  * On "Basic Information", under "Add features and functionality", click on "Slash Commands" and create a new command. On `Command` add the name that will be called (`check` or `bridge`). Put in "Request URL" field the HTTP path to your `check-slack-bot-slash` function. The function needs to be able to recognize URLs, so check the option "Escape channels, users, and links sent to your app". Save the changes.
* Finally, at the Check side **[9]**, create a new global API key and add to `config.js` as `checkApi.apiKey`.

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
* **[12]** The slash command let users trigger an interaction with your app directly from the message box in Slack. So, when a user posts the command defined (`check` or `bridge`), Slack makes a request to the `check-slack-bot-slash` lambda function and replies immediately to confirm the receipt. The function verify the text sent and calls the function `slash-response` if the team token is valid and the Slack user is registered on Check. **[11]**
* If the slash command message contains `set [project url]` the lambda function makes a GraphQL request to Check API **[15]** using the global token, asking for information about the project. If the project is valid, the function will save on Redis the channel and the project **[14]** and reply on Slack a success message. **[16]**
* If the slash command message contains `show` the lambda function verifies on Redis **[14]** if that channel is related to any Check project. If so, it replies on Slack the project URL that is defined for the channel **[16]**
* If the slash command message contains a URL, the lambda function verifies on Redis **[14]** if that channel is related to any Check project. If so, the funcion uses the user token to send a mutation to Check API and to create a project media **[15]**. After the mutation completes, it replies on Slack a message with the project media URL. **[16]**
* If the slash command message contains an empty string or a text that is not recognized, the lambda function replies on Slack with a message with the list of available commands. **[16]**
* If the slash command message contains `bot activate` or `bot send`, the lambda function verifies on Redis **[14]** if that Slack channel is related to a Smooch Bot conversation. If so and if the stored value says that the conversation is in "human" mode, it sends a mutation to Check API **[15]** in order to change to "bot" mode and then sends a message to Slack in order to inform that the mode has changed. **[16]**
* **[0]** When the Events API notifies about a message that was created by Smooch Slack App when the channel is automatically created, the bot reads the Smooch app name and Smooch user's phone number from that message and makes a request to Check API in order to get the Check annotation that holds information about that user **[1]**. The annotation and project are stored in Redis **[6]** and it also calls the `slash-response` function in order to associate the Slack channel with the Check project **[13]**. Finally, a message is sent to Slack just to say that the project was associated with the conversation. **[2]**
* **[0]** When the Events API notifies about a message that was created using the `/sk` command (so, from the Slack user to the Smooch user), the bot needs to move the Smooch conversation, on Check API side, from "bot" mode to "human" mode. So, it reads the information from Redis **[6]** and if the mode stored in Redis is "bot", then it sends a mutation to Check API **[1]** to move the conversation to "human" mode, saves the mode in Redis and finally sends a message to Slack to inform that the Smooch bot was temporarily disabled for that conversation. **[2]**
* **[0]** When the Events API notifies about a Slack channel that was archived, the bot needs to move the Smooch conversation, on Check API side, from "human" mode to "bot" mode. So, it reads the information from Redis **[6]** and if the mode stored in Redis is "human", then it sends a mutation to Check API **[1]** to move the conversation to "bot" mode and saves the mode in Redis too. **[6]**
* The Smooch Slack App doesn't support image uploads, so there is here a solution for this. When an image is uploaded and the related text starts with the command `/sk` **[0]**, the function `slash-response` is called **[13]**. The image is downloaded from Slack, converted to Base 64 and uploaded to ImgUr **[17]**. Then the `/sk` command that supports image URLs is called with the ImgUr URL **[16]**, and this way the image reaches the Smooch user.

## Tests

In order to run the tests, just run `npm test`.

## Run locally

You can run all functions locally with `node server.js`. Each function will be available in a different path. Then you can use something like Nginx to expose them to the world.
