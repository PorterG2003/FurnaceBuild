import './global.css';
import { Amplify } from 'aws-amplify';
import outputs from './amplify_outputs.json';

// Configure Amplify
Amplify.configure(outputs);

import 'expo-router/entry';
