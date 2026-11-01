// The app's views the export draws, handed over by the app at start-up (App.tsx). The export chunk reads them from
// here instead of importing the components, which would make the bundler split the engine out of the main chunk
// into a chunk of its own.

import type { Schematic } from '../ui/components/Schematic';

export const exportViews: { Schematic?: typeof Schematic } = {};
