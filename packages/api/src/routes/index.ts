import express from 'express';
import { checkAuthenticated } from '../services/auth/auth';
import { NextFunction, Request, RequestHandler, Response } from 'express';

export const indexRouter = express.Router();
// const fetchTodos = (req, res, next) => {
//     console.log("Some middleware");
//     next();
//   }
  
// indexRouter.get('/', (req, res, next) => {
//     console.log("test home page req user is:")
//     console.log(req.session);
//     if (!req.user) { return res.render('login'); }
//     next();
//   },   (req, res, next) => {
//     console.log("Some middleware");
//     next();
//   }, function(req, res, next) {
//     console.log("inner req is");
//     console.log(req.body);
//     res.locals.filter = null;
//     res.send("Helloooo")
//     //res.render('index', { user: req.user });
//   });

  indexRouter.get("/", checkAuthenticated, (req: Request, res: Response) => {
    console.log("showing home page");
    console.log(req.session)
    res.render("index", {name: req.user})
  })

