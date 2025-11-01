import './global.css';
import { Amplify } from 'aws-amplify';
import outputs from './amplify_outputs.json';
import '@/lib/supabase/client'; // Initialize Supabase client

// Configure Amplify
Amplify.configure(outputs);

import 'expo-router/entry';
