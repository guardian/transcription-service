import express from 'express';
import { initPassportAuth } from '../services/passport';

export const authRouter = express.Router();

authRouter.get('/login', function(req, res, next) {
    console.log("login is called");
    res.render('login');
  });