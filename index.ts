import 'react-native-gesture-handler';
import './global.css';
import '@/lib/supabase/client'; // Initialize Supabase client
import { logStartupConsoleBanner } from '@/lib/devtools/startupConsoleBanner';

logStartupConsoleBanner();

import 'expo-router/entry';
