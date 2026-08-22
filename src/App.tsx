import AppBase from './AppBase';
import { EditingOverlay } from './components/EditingOverlay';
import { ZoomWheelBehavior } from './components/ZoomWheelBehavior';

export default function App() {
  return (
    <>
      <AppBase />
      <EditingOverlay />
      <ZoomWheelBehavior />
    </>
  );
}
