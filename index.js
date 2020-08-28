require('dotenv').config();
const express = require('express');
const cors = require('cors');
const querystring = require('querystring');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const uniqid = require('uniqid');

const PORT = process.env.PORT || null;

const client_id = process.env.SPOTIFY_CLIENT_ID;
const client_secret = process.env.SPOTIFY_CLIENT_SECRET;

const spotifyAuthUrl = 'https://accounts.spotify.com/authorize';
const spotifyTokenUrl = 'https://accounts.spotify.com/api/token';

const defaultScope = [
  // See: https://developer.spotify.com/documentation/general/guides/scopes/
  'playlist-read-collaborative',
  'playlist-read-private',
  'user-library-read',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-email',
  'user-read-playback-state',
  'user-read-private',
];

const defaultReturnUrl = '/result';
const validReturnUrls = process.env.VALID_RETURN_URLS ? process.env.VALID_RETURN_URLS.split(',') : [];

function appUrl(url, req) {
  return `${req.protocol}://${req.hostname}${PORT ? `:${PORT}` : ''}${url}`;
}

function redirectUri(req) {
  return appUrl('/callback', req);
}

function requestParams(req) {
  const scope = (req.query.scope ? req.query.scope.split(',') : undefined) || defaultScope;
  const returnUrl = req.query.returnUrl || appUrl(defaultReturnUrl, req);
  return {
    scope,
    returnUrl,
  };
}

function validReturnUrl(returnUrl, req) {
  if (returnUrl === appUrl(defaultReturnUrl, req)) return true;
  if (validReturnUrls.indexOf(returnUrl) > -1) return true;
  return false;
}

function result(res, returnUrl = defaultReturnUrl, params = {}) {
  return res.redirect(`${returnUrl}?${querystring.stringify(params)}`);
}

const app = express();
app.enable('trust proxy'); // for Heroku
app.use(cors()).use(cookieParser());

app.get('/debug', function(req, res) {

  const state = uniqid();
  const redirect_uri = redirectUri(req);
  const { scope, returnUrl } = requestParams(req);

  const authQuery = {
    response_type: 'code',
    scope: scope.join(' '),
    client_id,
    redirect_uri,
    state,
  };

  const authUrl = `${spotifyAuthUrl}?${querystring.stringify(authQuery)}`;

  return res.send({
    PORT,
    redirect_uri,
    returnUrl,
    scope,
    authQuery,
    authUrl,
  });
});

app.get('/login', function(req, res) {

  const state = uniqid();
  const redirect_uri = redirectUri(req);
  const { scope, returnUrl } = requestParams(req);

  // check if valid return URI
  if (!validReturnUrl(returnUrl, req)) {
    res.status(403).send('Invalid return URI');
    return;
  }

  res.cookie('spotify-auth-state', state);
  res.cookie('spotify-auth-return-uri', returnUrl);

  const authQuery = {
    response_type: 'code',
    scope: scope.join(' '),
    client_id,
    redirect_uri,
    state,
  };

  const authUrl = `${spotifyAuthUrl}?${querystring.stringify(authQuery)}`;

  return res.redirect(authUrl);
});

app.get('/callback', function(req, res) {
  const code = req.query.code || null;
  const state = req.query.state || null;
  const storedState = req.cookies ? req.cookies['spotify-auth-state'] : null;
  const returnUrl = req.cookies ? req.cookies['spotify-auth-return-uri'] : defaultReturnUrl;

  res.clearCookie('spotify-auth-state');
  res.clearCookie('spotify-auth-return-uri');

  if (state === null || state !== storedState) {
    result(res, returnUrl, { error: 'state_mismatch' });
    return;
  }

  const postData = {
    code,
    redirect_uri: redirectUri(req),
    grant_type: 'authorization_code',
  };

  const postConfig = {
    headers: { 'Authorization': 'Basic ' + (new Buffer.from(client_id + ':' + client_secret).toString('base64')) },
  };

  axios.post(spotifyTokenUrl, querystring.stringify(postData), postConfig)
    .then(response => {
      result(res, returnUrl, response.data);
    })
    .catch(error => {
      result(res, returnUrl, { error: `Status ${error.response.status}: ${error.response.statusText}` });
    });

});

app.get('/refresh', function(req, res) {

  const refresh_token = req.query.refresh_token;

  const postData = {
    refresh_token,
    redirect_uri: redirectUri(req),
    grant_type: 'refresh_token',
  };

  const postConfig = {
    headers: { 'Authorization': 'Basic ' + (new Buffer.from(client_id + ':' + client_secret).toString('base64')) },
  };

  axios.post(spotifyTokenUrl, querystring.stringify(postData), postConfig)
    .then(response => {
      res.send(response.data);
    })
    .catch(error => {
      res.status(error.response.status).send(error);
    });

});

app.get(defaultReturnUrl, function(req, res) {
  res.send(req.query);
});

app.listen(PORT, () =>
  console.log(`Spotify Auth - listening on: ${PORT}`)
);
