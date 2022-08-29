import express from 'express';
import { createClient } from 'redis';
import fs from 'fs';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { json } from 'body-parser';

let sgbWords: string[];

fs.readFile('./res/sgb-words.txt', (err, data) => {
  if (err) throw err;
  sgbWords = data.toString().split('\n');
});

const redis = createClient();
redis.connect();

mongoose.connect('mongodb://localhost:27017/remotd');
const motdSchema = new mongoose.Schema({
  _id: String,
  from: String,
  to: String,
  message: String,
});
const Motd = mongoose.model('MotdPair', motdSchema);

const app = express();
const port = 5572;

app.use(json());
app.use((req, res, next) => {
  if (req.path === '/ping') next();
  const userKey = req.header('UserKey');
  if (userKey) {
    res.locals.userKey = userKey;
    next();
  } else {
    res.sendStatus(401);
  }
});

const randomSgbWord = () => sgbWords[Math.floor(Math.random() * sgbWords.length)];

app.get('/ping', (req, res) => {
  res.send('pong');
});

app.get('/pair', (req, res) => {
  const phrase = `${randomSgbWord()}-${randomSgbWord()}-${randomSgbWord()}-${randomSgbWord()}-${randomSgbWord()}`;
  const myMotdId = crypto.randomUUID();
  const friendMotdId = crypto.randomUUID();
  redis.hSet(phrase, 'userKey', res.locals.userKey); // Register pairing phrase in redis with the user's key making the pairing request
  redis.hSet(phrase, 'myMotdId', myMotdId); // Save new motd ids
  redis.hSet(phrase, 'friendMotdId', friendMotdId);
  redis.expire(phrase, 3 * 24 * 60 * 60); // 3 days
  res.send({ phrase, myMotdId, friendMotdId });
});

const newMotdMessage = 'Thanks for using remotd!';

app.post('/pair', async (req, res) => {
  const { phrase } = req.body;
  if (phrase) {
    const friendUserKey = await redis.hGet(phrase, 'userKey'); // Get user's key that requested pairing from redis
    const friendMotdId = await redis.hGet(phrase, 'myMotdId'); // Grab ids of motds, but flipped since this is the friend's request
    const myMotdId = await redis.hGet(phrase, 'friendMotdId');
    if (friendUserKey && friendMotdId && myMotdId) {
      await Motd.create({
        _id: myMotdId,
        from: friendUserKey,
        to: res.locals.userKey,
        message: newMotdMessage,
      });
      await Motd.create({
        _id: friendMotdId,
        from: res.locals.userKey,
        to: friendUserKey,
        message: newMotdMessage,
      });
      await redis.del(phrase);
      res.send({ myMotdId, friendMotdId });
    } else {
      res.sendStatus(404);
    }
  } else {
    res.sendStatus(400);
  }
});

app.get('/motds/:id', async (req, res) => {
  const motdId = req.params.id;
  if (motdId) {
    const motd = await Motd.findById(motdId).exec();
    if (motd && motd.to === res.locals.userKey) {
      res.send({ message: motd.message });
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

app.get('/motds', async (req, res) => {
  res.send(await Motd.find({ to: res.locals.userKey }, 'message'));
});

app.patch('/motds/:id', async (req, res) => {
  const motdId = req.params.id;
  const { message } = req.body;
  if (motdId && message) {
    const motd = await Motd.findById(motdId).exec();
    if (motd && motd.from === res.locals.userKey) {
      motd.message = message;
      await motd.save();
      res.sendStatus(200);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

app.listen(port, () => {
  console.log(`chillin on port ${port}`);
});
