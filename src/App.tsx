import AppBase from './AppBase';
import { MultiSelectBehavior } from './components/MultiSelectBehavior';
import { EditingOverlay } from './components/EditingOverlay';
import { ZoomWheelBehavior } from './components/ZoomWheelBehavior';
import { BrandLogoBehavior } from './components/BrandLogoBehavior';
import { BulkStemDropBehavior } from './components/BulkStemDropBehavior';

export default function App() {
  return (
    <>
      <AppBase />
      <MultiSelectBehavior />
      <EditingOverlay />
      <ZoomWheelBehavior />
      <BrandLogoBehavior />
      <BulkStemDropBehavior />
    </>
  );
}
