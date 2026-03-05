import { useState, useEffect, useRef } from 'react';
import * as Location from 'expo-location';

export interface LocationState {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  error: string | null;
  loading: boolean;
}

/**
 * useLocation — requests GPS permission and returns current coordinates.
 * Polls every `intervalMs` milliseconds (default: 30s).
 */
export function useLocation(intervalMs = 30_000) {
  const [state, setState] = useState<LocationState>({
    latitude: null,
    longitude: null,
    accuracy: null,
    error: null,
    loading: true,
  });

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setState((s) => ({ ...s, error: 'Location permission denied', loading: false }));
        return;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      setState({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: loc.coords.accuracy,
        error: null,
        loading: false,
      });
    } catch (e: any) {
      setState((s) => ({ ...s, error: e.message, loading: false }));
    }
  };

  useEffect(() => {
    fetchLocation();
    timerRef.current = setInterval(fetchLocation, intervalMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [intervalMs]);

  return state;
}
