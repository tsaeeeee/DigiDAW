import AppBase from './AppBase';
import { EditingOverlay } from './components/EditingOverlay';
import { ZoomWheelBehavior } from './components/ZoomWheelBehavior';
import { BrandLogoBehavior } from './components/BrandLogoBehavior';

export default function App() {
  return (
    <>
      <AppBase />
      <EditingOverlay />
      <ZoomWheelBehavior />
      <BrandLogoBehavior />
    </>
  );
}
