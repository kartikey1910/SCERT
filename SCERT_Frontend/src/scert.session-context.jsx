import { createContext, useContext } from 'react';

export const ScertSessionContext = createContext(null);

export function useSession() {
  return useContext(ScertSessionContext);
}
