# Goal

[![Greenkeeper badge](https://badges.greenkeeper.io/aizatto/serverless-weather-calendar.svg)](https://greenkeeper.io/)

I wanted to display the weather in my calendar, and I thought I would prototype such a service using serverless.

Feel free to deploy your own service, but you need to get an OpenWeather API key https://openweathermap.org/api

Friends can ask me for the URL and you can use mine.

# Commands
```sh
serverless invoke local --function openweather2ical --stage dev --region ap-southeast-1 --data '{"queryStringParameters":{"id":1735158}}'
```

Test locally

```fish
 env NODE_ENV=production serverless invoke local --function openweather2ical --stage dev --region ap-southeast-1 --data '{"queryStringParameters":{"id":1735158}}'
```

```fish
env NODE_ENV=production sls deploy --region ap-southeast-1 --stage prod
```