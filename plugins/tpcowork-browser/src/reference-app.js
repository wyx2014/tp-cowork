import { app } from 'electron';

// Chrome helper discovery uses the owning DSH application paths.
export const isElectronAppPackaged = () => app.isPackaged;
export const getElectronAppPath = name => app.getPath(name);
