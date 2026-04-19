import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export const FlightSkeleton = () => (
  <Card className="mb-4 bg-white/50 animate-pulse border-gray-100">
    <CardContent className="p-4 flex justify-between items-center">
      <div className="flex gap-4 items-center">
        <div className="w-10 h-10 bg-gray-200 rounded-full" />
        <div className="space-y-2">
          <div className="h-4 w-24 bg-gray-200 rounded" />
          <div className="h-3 w-16 bg-gray-200 rounded" />
        </div>
      </div>
      <div className="h-8 w-20 bg-gray-200 rounded-full" />
    </CardContent>
  </Card>
);

export const HotelSkeleton = () => (
  <Card className="mb-4 bg-white/50 animate-pulse border-gray-100 overflow-hidden">
    <div className="h-40 w-full bg-gray-200" />
    <CardContent className="p-4">
      <div className="h-5 w-1/2 bg-gray-200 rounded mb-2" />
      <div className="h-4 w-1/3 bg-gray-200 rounded mb-4" />
      <div className="flex gap-2">
        <div className="h-6 w-16 bg-gray-200 rounded-full" />
        <div className="h-6 w-16 bg-gray-200 rounded-full" />
      </div>
    </CardContent>
  </Card>
);

export const EventSkeleton = () => (
  <Card className="mb-4 bg-white/50 animate-pulse border-gray-100">
    <CardContent className="p-4 flex gap-4">
      <div className="w-16 h-16 bg-gray-200 rounded-lg shrink-0" />
      <div className="w-full space-y-2">
        <div className="h-4 w-3/4 bg-gray-200 rounded" />
        <div className="h-3 w-1/2 bg-gray-200 rounded" />
      </div>
    </CardContent>
  </Card>
);

export const RestaurantSkeleton = () => (
  <Card className="mb-2 bg-white/50 animate-pulse border-gray-100">
    <CardContent className="p-3 flex justify-between items-center">
      <div className="space-y-2">
        <div className="h-4 w-32 bg-gray-200 rounded" />
        <div className="h-3 w-20 bg-gray-200 rounded" />
      </div>
      <div className="h-8 w-8 bg-gray-200 rounded-full" />
    </CardContent>
  </Card>
);

export const DaySkeleton = () => (
  <div className="mb-8 pl-6 border-l-2 border-gray-200 relative animate-pulse">
    <div className="absolute w-4 h-4 bg-gray-200 rounded-full -left-[9px] top-0" />
    <div className="h-6 w-32 bg-gray-200 rounded mb-4" />
    <div className="space-y-4">
      <div className="h-20 w-full bg-gray-100 rounded-xl" />
      <div className="h-20 w-full bg-gray-100 rounded-xl" />
    </div>
  </div>
);

export const GenericLoader = ({ message = "Loading..." }) => (
  <div className="flex flex-col items-center justify-center p-8 text-gray-400">
    <Loader2 className="w-6 h-6 animate-spin mb-2" />
    <span className="text-sm font-medium">{message}</span>
  </div>
);
