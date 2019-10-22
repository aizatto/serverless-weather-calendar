import { APIGatewayProxyHandler } from 'aws-lambda';
import fetch from 'node-fetch';
import * as querystring from 'querystring';
import 'source-map-support/register';
import * as fs from 'fs-extra';
import * as icalGenerator from 'ical-generator';
import * as dateFns from 'date-fns';
import { SSM } from 'aws-sdk';
const ssm = new SSM();

interface Weather {
  id: number,
  main: string,
  description: string,
  icon: string,
}

interface Temperature {
  temp: number
  temp_max: number,
  temp_min: number,
}

interface CurrentForecast {
  cod: number, // this is inconsistent
  message: string,
  id: number,
  timezone: number,
  dt: number,
  name: string,
  main: {
    temp: number,
    pressure: number,
    humidity: number,
    temp_min: number,
    temp_max: number,
  },
  weather: Weather[],
}

interface FiveDayForecast {
  cod: string,
  message: string,
  city: {
    id: number,
    name: string,
    population: number,
    sunrise: number,
    sunset: number,
    timezone: number,
  },
  list: {
    clouds: {
      all: number,
    },
    dt: number,
    dt_text: string,
    main: {
      grnd_level: number, 
      humidity: number, 
      pressure: number, 
      sea_level: number, 
      temp: number, 
      temp_kf: number, 
      temp_max: number, 
      temp_min: number, 
    },
    rain: {
      '3h': string,
    },
    sys: {
      pod: string,
    },
    weather: Weather[],
    wind: {
      deg: number,
      speed: number,
    },
  }[],
}

interface WeatherToICal {
  dt: number,
  start: Date,
  end: Date,
  weather: Weather,
  temperature: Temperature,
};

export const openweather2ical: APIGatewayProxyHandler = async (event, _context) => {
  const response = await ssm.getParameter({
    Name: 'OPEN_WEATHER_API_KEY',
  }).promise();
  
  const APPID = response['Parameter']['Value'];

  const qs = {
    APPID,
    units: 'metric',
  };

  const { id, lat, lng, q, zip, units } = event.queryStringParameters;
  if (id) {
    qs['id'] = id;
  } else if ( lat && lng ) {
    qs['lat'] = lat;
    qs['lng'] = lng;
  } else if (q) {
    qs['q'] = q;
  } else if (zip) {
    qs['zip'] = zip;
  } else {
    return {
      statusCode: 400,
      body: 'Invalid Query String Parameters'
    }
  }

  if (units) {
    qs['units'] = units;
  }

  let qss = querystring.stringify(qs);

  let fiveDayJson: FiveDayForecast | null = null;
  if (process.env.NODE_ENV === 'production') {
    const response = await fetch('https://api.openweathermap.org/data/2.5/forecast?' + qss)
    fiveDayJson = await response.json();
  } else {
    const buffer = await fs.readFile('../../data/forecast.json');
    fiveDayJson = JSON.parse(buffer);
  }

  if (fiveDayJson === null ||
      fiveDayJson === undefined) {
    return {
      statusCode: 500,
      body: 'Invalid JSON',
    }
  }

  if (`${fiveDayJson.cod}` !== "200") {
    return {
      statusCode: 500,
      body: fiveDayJson.message,
    }
  }

  let currentWeatherJson: CurrentForecast | null = null;
  if (process.env.NODE_ENV === 'production') {
    const response = await fetch('https://api.openweathermap.org/data/2.5/weather?' + qss)
    currentWeatherJson = await response.json();
  } else {
    const buffer = await fs.readFile('../../data/weather.json');
    currentWeatherJson = JSON.parse(buffer);
  }

  if (currentWeatherJson === null ||
      currentWeatherJson === undefined) {
    return {
      statusCode: 500,
      body: 'Invalid JSON',
    }
  }

  if (`${currentWeatherJson.cod}` !== "200") {
    return {
      statusCode: 500,
      body: currentWeatherJson.message,
    }
  }

  const ical = icalGenerator({
    name: `OpenWeather: ${fiveDayJson.city.name}`,
    timezone: 'UTC',
  })

  const list: WeatherToICal[] = [];

  list.push({
    dt: currentWeatherJson.dt,
    start: new Date(currentWeatherJson.dt * 1000),
    end: new Date(fiveDayJson.list[0].dt * 1000),
    weather: currentWeatherJson.weather[0],
    temperature: {
      temp: currentWeatherJson.main.temp,
      temp_max: currentWeatherJson.main.temp_max,
      temp_min: currentWeatherJson.main.temp_min,
    },
  });

  fiveDayJson.list.forEach(weather => {
    list.push({
      dt: weather.dt,
      start: new Date(weather.dt * 1000),
      end: new Date(weather.dt * 1000 + 3 * 60 * 60 * 1000),
      weather: weather.weather[0],
      temperature: {
        temp: weather.main.temp,
        temp_max: weather.main.temp_max,
        temp_min: weather.main.temp_min,
      },
    });
  });

  const getSummary = (weather: Weather, temp: Temperature) => {
    let emoji = null;
    switch (weather.id) {
      // main: Rain
      case 500:
        // description: light rain
      case 501:
        // description: moderate rain
        emoji = '🌧️';
        break;

      case 800:
        // main: Clear
        // description: clear sky
        emoji = '☀️';
        break;


      // main: Clouds
      case 801:
        // description: few clouds
      case 802:
        // description: 'scatered clouds',
      case 803:
        // description: 'broken clouds',
      case 804:
        // description: 'overcast clouds',
        emoji = '☁️';
        break;
    }

    if (emoji) {
      emoji = emoji + ''
    }

    return `${emoji}${weather.description}: ${temp.temp.toFixed(2)}c (${temp_min}c - ${temp_max}c)`;
  }

  const getDescription = (start: Date, end: Date) => {
    return `For about ${dateFns.formatDistance(start, end)}`;
  }

  const createEvent = (weather: WeatherToICal, temp: Temperature): icalGenerator.ICalEvent => {
    return ical.createEvent({
      uid: `${currentWeatherJson.id}:${weather.dt}`,
      summary: getSummary(weather.weather, temp),
      description: getDescription(weather.start, weather.end),
      start: weather.start,
      end: weather.end,
      stamp: weather.start,
      created: new Date(),
    })
  }

  let currentWeather = list[0];
  let { temp, temp_min, temp_max} = list[0].temperature;
  let icalEvent = createEvent(list[0], list[0].temperature);
  let tempAverage = temp;
  let tempTotal = temp;
  let tempCount = 1;

  list.forEach(weather => {
    if (weather.weather.id === currentWeather.weather.id) {
      temp_min = Math.min(temp_min, weather.temperature.temp_min, temp);
      temp_max = Math.max(temp_max, weather.temperature.temp_max, temp);

      tempTotal = tempTotal + weather.temperature.temp;
      tempCount += 1;
      tempAverage = tempTotal / tempCount;

      icalEvent.summary(getSummary(
        currentWeather.weather,
        {
          temp: tempAverage,
          temp_min,
          temp_max,
        }
      ));
      icalEvent.description(getDescription(
        currentWeather.start,
        weather.end,
      ))
      icalEvent.end(weather.end);

    } else {
      currentWeather = weather;
      icalEvent = createEvent(weather, weather.temperature);
      temp = weather.temperature.temp;
      temp_min = weather.temperature.temp_min;
      temp_max = weather.temperature.temp_max;

      tempAverage = temp;
      tempTotal = temp;
      tempCount = 1;
    }
  })

  // ical.createEvent({
  //   uid: `${fiveDayJson.city.id}:${currentWeather.dt}`,
  //   summary: `${currentWeather.weather[0].description}`,
  //   start: new Date(currentWeather.dt * 1000),
  //   end: new Date(fiveDayJson.list[0].dt * 1000),
  //   stamp: new Date(currentWeather.dt * 1000),
  //   created: new Date(),
  // });

  // fiveDayJson.list.forEach(weather => {
  //   const start = new Date(weather.dt * 1000);
  //   ical.createEvent({
  //     uid: `${fiveDayJson.city.id}:${weather.dt}`,
  //     summary: `${weather.weather[0].description}`,
  //     start: start,
  //     end: new Date(weather.dt * 1000 + 3 * 60 * 60 * 1000),
  //     stamp: start,
  //     created: new Date(),
  //   });
  // })

  return {
    statusCode: 200,
    headers: {
      "content-type": "text/calendar",
    },
    body: ical.toString(),
  };
}