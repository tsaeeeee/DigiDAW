import AppBase from './AppBase';
import { EditingOverlay } from './components/EditingOverlay';
import { ZoomWheelBehavior } from './components/ZoomWheelBehavior';
import { BrandLogoBehavior } from './components/BrandLogoBehavior';
import { BulkStemDropBehavior } from './components/BulkStemDropBehavior';

export default function App() {
  return (
    <>
      <AppBase />
      <EditingOverlay />
      <ZoomWheelBehavior />
      <BrandLogoBehavior />
      <BulkStemDropBehavior />
    </>
  );
}
