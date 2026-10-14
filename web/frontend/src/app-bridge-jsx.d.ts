import type { SAppNavAttributes } from '@shopify/app-bridge-types';

/**
 * @shopify/app-bridge-types declares its elements on the global `JSX`
 * namespace, but React 19's automatic runtime resolves elements through
 * `React.JSX`, so they are invisible to TSX. Polaris types already target
 * `React.JSX`; this re-registers the one App Bridge element the app uses.
 */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      's-app-nav': SAppNavAttributes;
    }
  }
}
