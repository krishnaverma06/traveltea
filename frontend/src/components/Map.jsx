import { useEffect, useRef } from"react";
import {
 MapContainer,
 TileLayer,
 Marker,
 Popup,
 useMap,
} from"react-leaflet";
import L from"leaflet";
import"leaflet/dist/leaflet.css";

// Fix default marker icon issue with Leaflet in React
import markerIcon2x from"leaflet/dist/images/marker-icon-2x.png";
import markerIcon from"leaflet/dist/images/marker-icon.png";
import markerShadow from"leaflet/dist/images/marker-shadow.png";

delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
 iconUrl: markerIcon,
 iconRetinaUrl: markerIcon2x,
 shadowUrl: markerShadow,
});

// Component to update map view when locations change
function MapUpdater({ locations }) {
 const map = useMap();

 useEffect(() => {
 if (locations.length > 0) {
 // Fit bounds to show all markers
 const bounds = L.latLngBounds(
 locations.map((loc) => [loc.lat, loc.lon])
 );

 map.fitBounds(bounds, {
 padding: [50, 50],
 });
 }
 }, [locations, map]);

 return null;
}

// Pans/zooms to a single location without disturbing the other markers and opens its popup
function MapFocus({ focus, markerRefs }) {
 const map = useMap();

 useEffect(() => {
 if (focus) {
 // Fly to the location and zoom in closely (level 18 is street-level)
 map.flyTo([focus.lat, focus.lon], 18, { animate: true, duration: 1.5 });
 
 // Open the corresponding marker's popup right as the animation finishes
 setTimeout(() => {
 const marker = markerRefs.current[`${focus.lat}-${focus.lon}`];
 if (marker) {
 marker.openPopup();
 }
 }, 1200);
 }
 }, [focus, map, markerRefs]);

 return null;
}

export function Map({
 locations,
 focus,
 center = [48.8566, 2.3522],
 zoom = 13,
}) {
 const markerRefs = useRef({});

 // Use first location as center if available
 const mapCenter =
 locations.length > 0
 ? [locations[0].lat, locations[0].lon]
 : center;

 return (
 <div className="h-full w-full relative">
 <MapContainer
 center={mapCenter}
 zoom={zoom}
 style={{
 height:"100%",
 width:"100%",
 }}
 scrollWheelZoom={true}
 >
 <TileLayer
 attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
 url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
 />

 {locations.map((location, index) => (
 <Marker
 key={index}
 position={[location.lat, location.lon]}
 ref={(m) => {
 if (m) {
 markerRefs.current[`${location.lat}-${location.lon}`] = m;
 }
 }}
 eventHandlers={{
 mouseover: (e) => e.target.openPopup(),
 }}
 >
 <Popup className="custom-popup" minWidth={240} maxWidth={280}>
 <div className="flex flex-col -m-[13px] sm:-m-[14px] overflow-hidden rounded-xl bg-card font-sans">
 {location.imageUrl ? (
 <div className="h-32 w-full relative">
 <img
 src={location.imageUrl}
 alt={location.name}
 className="absolute inset-0 w-full h-full object-cover"
 />
 {location.category && (
 <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded-full">
 {location.category}
 </div>
 )}
 </div>
 ) : (
 location.category && (
 <div className="bg-primary text-primary-foreground text-white text-[10px] uppercase font-bold px-3 py-1.5 rounded-t-xl">
 {location.category}
 </div>
 )
 )}
 
 <div className="p-3.5">
 <h3 className="font-bold text-foreground text-sm leading-tight mb-1.5">
 {location.name}
 </h3>
 
 <div className="flex flex-wrap items-center gap-2 mb-2 text-xs font-medium text-muted-foreground">
 {location.duration && (
 <span className="flex items-center gap-1 bg-gray-100 px-1.5 py-0.5 rounded-md">
 ⏱️ {location.duration}
 </span>
 )}
 {location.estimatedCost && (
 <span className="flex items-center gap-1 bg-green-50 text-green-700 px-1.5 py-0.5 rounded-md">
 💲 {location.estimatedCost}
 </span>
 )}
 </div>
 
 {location.description && (
 <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
 {location.description}
 </p>
 )}
 </div>
 </div>
 </Popup>
 </Marker>
 ))}

 <MapUpdater locations={locations} />
 <MapFocus focus={focus} markerRefs={markerRefs} />
 </MapContainer>
 </div>
 );
}