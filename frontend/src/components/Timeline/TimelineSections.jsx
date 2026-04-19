import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ExternalLink, Star, MapPin, Ticket, Plane, Hotel, Navigation } from 'lucide-react';

export const FlightCard = ({ flight }) => (
  <Card className="mb-4 hover:shadow-md transition-shadow">
    <CardContent className="p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
      <div className="flex items-center gap-4 w-full sm:w-auto">
        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
          <Plane className="w-6 h-6 text-blue-600" />
        </div>
        <div>
          <h4 className="font-semibold text-gray-900">{flight.airline}</h4>
          <p className="text-sm text-gray-600">
            {flight.departure.iata} → {flight.arrival.iata} • {flight.duration}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto border-t sm:border-0 pt-4 sm:pt-0">
        <div className="text-right">
          <div className="font-bold text-lg">{flight.price.amount} {flight.price.currency}</div>
          <div className="text-xs text-gray-500">{flight.stops === 0 ? 'Direct' : `${flight.stops} Stop(s)`}</div>
        </div>
        {flight.bookingUrl && (
          <Button size="sm" variant="outline" onClick={() => window.open(flight.bookingUrl, '_blank')}>
            Book
          </Button>
        )}
      </div>
    </CardContent>
  </Card>
);

export const HotelCard = ({ hotel }) => (
  <Card className="mb-4 overflow-hidden hover:shadow-md transition-shadow group">
    {hotel.image && (
      <div className="h-48 w-full overflow-hidden">
        <img src={hotel.image} alt={hotel.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
      </div>
    )}
    <CardContent className="p-4">
      <div className="flex justify-between items-start mb-2">
        <div>
          <h4 className="font-semibold text-gray-900 text-lg flex items-center gap-2">
            <Hotel className="w-5 h-5 text-purple-500" />
            {hotel.name}
          </h4>
          <div className="flex items-center gap-1 mt-1 text-sm text-gray-600">
            <MapPin className="w-4 h-4" />
            <span className="truncate">{hotel.address}</span>
          </div>
        </div>
        {hotel.price && (
          <div className="text-right bg-green-50 px-3 py-1 rounded-lg">
            <div className="font-bold text-green-700">{hotel.price.amount} {hotel.price.currency}</div>
            <div className="text-xs text-green-600/80">per night</div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        {hotel.amenities?.slice(0, 4).map((amenity, idx) => (
          <span key={idx} className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
            {amenity.replace(/_/g, ' ')}
          </span>
        ))}
      </div>
    </CardContent>
  </Card>
);

export const EventCard = ({ event }) => (
  <Card className="mb-4 hover:shadow-md transition-shadow overflow-hidden flex flex-col sm:flex-row">
    {event.imageUrl && (
      <div className="sm:w-1/3 h-40 sm:h-auto shrink-0">
        <img src={event.imageUrl} alt={event.name} className="w-full h-full object-cover" />
      </div>
    )}
    <CardContent className="p-4 flex flex-col justify-between flex-1">
      <div>
        <div className="flex justify-between items-start mb-1">
          <h4 className="font-semibold text-gray-900 line-clamp-2">{event.name}</h4>
          <span className="px-2 py-0.5 bg-pink-100 text-pink-700 text-xs rounded-full whitespace-nowrap ml-2">
            {event.category}
          </span>
        </div>
        <p className="text-sm text-gray-600 mb-1">{new Date(event.startDate).toLocaleDateString()} {event.time && `at ${event.time}`}</p>
        <p className="text-sm text-gray-500 flex items-center gap-1 line-clamp-1">
          <MapPin className="w-3 h-3" /> {event.venue}
        </p>
      </div>
      <div className="mt-4 text-right">
        <Button size="sm" className="w-full sm:w-auto bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white" onClick={() => window.open(event.ticketUrl, '_blank')}>
          <Ticket className="w-4 h-4 mr-2" /> Get Tickets
        </Button>
      </div>
    </CardContent>
  </Card>
);

export const RestaurantCard = ({ restaurant }) => (
  <Card className="mb-3 hover:shadow-sm transition-shadow">
    <CardContent className="p-3 flex items-center gap-3">
      {restaurant.imageUrl ? (
        <img src={restaurant.imageUrl} alt={restaurant.name} className="w-16 h-16 rounded-lg object-cover shrink-0" />
      ) : (
        <div className="w-16 h-16 bg-orange-100 rounded-lg flex items-center justify-center shrink-0">
          <span className="text-2xl">🍽️</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <h5 className="font-semibold text-gray-900 truncate">{restaurant.name}</h5>
        <div className="flex items-center gap-2 text-xs text-gray-600 mt-1 truncate">
          <span className="flex items-center text-amber-500 font-medium">
            <Star className="w-3 h-3 mr-0.5 fill-current" /> {restaurant.rating}
          </span>
          <span>({restaurant.reviewCount})</span>
          {restaurant.priceLevel && <span>• {restaurant.priceLevel}</span>}
          {restaurant.cuisine?.[0] && <span>• {restaurant.cuisine[0]}</span>}
        </div>
      </div>
      <a 
        href={restaurant.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${restaurant.location.latitude},${restaurant.location.longitude}`} 
        target="_blank" 
        rel="noreferrer"
        className="w-10 h-10 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-blue-600 transition-colors shrink-0"
        title="Open in Google Maps"
      >
        <Navigation className="w-4 h-4" />
      </a>
    </CardContent>
  </Card>
);
