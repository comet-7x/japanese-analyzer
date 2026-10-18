'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import {
  EXTERNAL_SERVICES_KEY, ICHI_OPTIONS_KEY, readExternalServicesSettings, readIchiOptions,
  DEFAULT_EXTERNAL_SERVICES, DEFAULT_ICHI_OPTIONS,
  type ExternalServicesSettings, type IchiMoeOptions,
} from '../lib/dictionary';
import { browserStorage } from '../utils/storage';

const ExternalLookupContext = createContext<{
  services: ExternalServicesSettings;
  ichiOptions: IchiMoeOptions;
  updateServices: (value: ExternalServicesSettings) => void;
  updateIchiOptions: (value: IchiMoeOptions) => void;
} | null>(null);

export function ExternalLookupProvider({ children }: { children: React.ReactNode }) {
  const [services, setServices] = useState(() => readExternalServicesSettings(null));
  const [ichiOptions, setIchiOptions] = useState(() => readIchiOptions(null));

  useEffect(() => {
    setServices(readExternalServicesSettings(browserStorage.getItem(EXTERNAL_SERVICES_KEY)));
    setIchiOptions(readIchiOptions(browserStorage.getItem(ICHI_OPTIONS_KEY)));
    const onStorage = (event: StorageEvent) => {
      if (event.key === EXTERNAL_SERVICES_KEY || event.key === null) {
        setServices(readExternalServicesSettings(event.newValue));
      }
      if (event.key === ICHI_OPTIONS_KEY || event.key === null) {
        setIchiOptions(readIchiOptions(event.newValue));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const updateServices = (value: ExternalServicesSettings) => {
    setServices(value);
    browserStorage.setItem(EXTERNAL_SERVICES_KEY, JSON.stringify(value));
  };
  const updateIchiOptions = (value: IchiMoeOptions) => {
    setIchiOptions(value);
    browserStorage.setItem(ICHI_OPTIONS_KEY, JSON.stringify(value));
  };

  return <ExternalLookupContext.Provider value={{ services, ichiOptions, updateServices, updateIchiOptions }}>
    {children}
  </ExternalLookupContext.Provider>;
}

export function useExternalLookupSettings() {
  const context = useContext(ExternalLookupContext);
  if (!context) {
    return {
      services: DEFAULT_EXTERNAL_SERVICES,
      ichiOptions: DEFAULT_ICHI_OPTIONS,
      updateServices: () => {},
      updateIchiOptions: () => {},
    };
  }
  return context;
}
