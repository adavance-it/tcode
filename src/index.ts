#!/usr/bin/env node
import * as path from 'path';
import { App } from './app';

const arg = process.argv[2];
const root = arg ? path.resolve(arg) : process.cwd();

const app = new App(root);
app.run();
