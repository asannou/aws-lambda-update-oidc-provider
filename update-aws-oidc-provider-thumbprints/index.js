#!/usr/bin/env node
'use strict';

const url = require('node:url');
const { Resolver } = require('node:dns').promises;
const https = require('node:https');
const tls = require('node:tls');
const AWS = require('aws-sdk');

const resolver = new Resolver();
const sts = new AWS.STS();
const iam = new AWS.IAM();

Array.prototype.unique = function() {
  return Array.from(new Set(this));
};

async function list() {
  const providers = await iam.listOpenIDConnectProviders().promise();
  const excluded = await listArns(process.env.EXCLUDED_PROVIDERS);
  return providers.OpenIDConnectProviderList
    .filter((provider) => !excluded.includes(provider.Arn));
}

async function listArns(providers = '') {
  const identity = await sts.getCallerIdentity().promise();
  const accountId = identity.Account;
  return providers.split(' ')
    .map((provider) => `arn:aws:iam::${accountId}:oidc-provider/${provider}`);
}

function get(...args) {
  return iam.getOpenIDConnectProvider(...args).promise();
}

async function update(...args) {
  const response = await iam.updateOpenIDConnectProviderThumbprint(...args)
    .promise().catch((err) => err.message);
  console.log(args, response);
  return response;
}

async function updateThumbprints(arn) {
  const params = {
    OpenIDConnectProviderArn: arn,
    ThumbprintList: await getThumbprintList(arn)
  };
  return await update(params);
}

async function getThumbprintList(arn) {
  const provider = await get({ OpenIDConnectProviderArn: arn });
  const jwksUri = await getJwksUri(provider.Url);
  const addresses = await resolver.resolve4(jwksUri.hostname);
  const connects = addresses.map((address) => connect(
    jwksUri.port || 443,
    address,
    jwksUri.hostname
  ));
  const thumbprints = (await Promise.all(connects)).filter(Boolean);
  const maxLength = 5;
  return thumbprints.concat(provider.ThumbprintList)
    .unique().splice(0, maxLength);
}

async function getJwksUri(providerUrl) {
  const configUrl = `https://${providerUrl}/.well-known/openid-configuration`;
  const { jwks_uri } = await httpsGet(configUrl);
  return url.parse(jwks_uri);
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: 'GET' }, (response) => {
      let data = '';
      response.on('data', (chunk) => data += chunk);
      response.on('end', () => resolve(JSON.parse(data)));
    });
    request.on('error', reject);
    request.end();
  });
}

function connect(port, address, servername) {
  const log = (message) => console.log(Array.from(arguments), message);
  return new Promise((resolve, reject) => {
    const options = { servername: servername };
    const socket = tls.connect(port, address, options, () => {
      socket.end();
      const cert = socket.getPeerCertificate();
      if (socket.authorized) {
        const fingerprint = cert.fingerprint.replace(/:/g, '').toLowerCase();
        log(fingerprint);
        resolve(fingerprint);
      } else {
        log(socket.authorizationError);
        resolve();
      }
    });
    socket.on('error', (err) => {
      log(err.message);
      socket.destroy();
    });
  });
}

exports.handler = async (event, context, callback) => {
  const providers = await list();
  const updates = providers.map((provider) => updateThumbprints(provider.Arn));
  callback(null, await Promise.all(updates));
};

if (require.main === module) {
  exports.handler(undefined, undefined, (err, data) => {});
}

