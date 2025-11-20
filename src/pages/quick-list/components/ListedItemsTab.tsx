import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronLeft, ChevronRight, SquareArrowOutUpRight, Trash2, Search, X as XIcon } from "lucide-react";
import Fuse from 'fuse.js';
import { MarketListingEntry } from '@/common/types/pd2-website/GetMarketListingsResponse';
import { usePd2Website } from '@/hooks/pd2website/usePD2Website';
import { useOptions } from '@/hooks/useOptions';
import { buildGetAllUserMarketListingsQuery } from '@/pages/price-check/lib/tradeUrlBuilder';
import { qualityColor } from '@/pages/price-check/lib/qualityColor';
import { emit } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { PD2Website } from '@/common/constants';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import moment from 'moment';
import { shortcutFormSchema, ShortcutFormData } from './types';
import { Form } from '@/components/ui/form';
import { FormField, FormItem, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { priceTypeOptions } from './types';
import ItemStatsDisplay from './ItemStatsDisplay';
import { ButtonGroup } from '@/components/ui/button-group';

interface ListedItemsTabProps {
  onClose: () => void;
  initialListings?: MarketListingEntry[];
  initialTotalCount?: number;
  onTotalCountChange?: (count: number) => void;
  onListingsChange?: (listings: MarketListingEntry[]) => void;
}

const ITEMS_PER_PAGE = 5;

const ListedItemsTab: React.FC<ListedItemsTabProps> = ({ 
  onClose, 
  initialListings, 
  initialTotalCount,
  onTotalCountChange,
  onListingsChange
}) => {
  const { getMarketListings, updateMarketListing, updateItemByHash, deleteMarketListing, authData } = usePd2Website();
  const { settings } = useOptions();
  const [listings, setListings] = useState<MarketListingEntry[]>(initialListings || []);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalCount, setTotalCount] = useState(initialTotalCount || 0);
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [bumpingListingId, setBumpingListingId] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [allListingsForSearch, setAllListingsForSearch] = useState<MarketListingEntry[]>([]);
  const [isLoadingAllListings, setIsLoadingAllListings] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);

  const editForm = useForm<ShortcutFormData>({
    resolver: zodResolver(shortcutFormSchema),
    defaultValues: { type: 'exact', note: '', price: '', currency: 'HR' },
  });

  const marketQuery = useMemo(() => {
    if (!authData || !settings) return null;
    return buildGetAllUserMarketListingsQuery(
      authData.user._id,
      settings.mode === 'hardcore',
      settings.ladder === 'ladder',
      ITEMS_PER_PAGE,
      currentPage * ITEMS_PER_PAGE
    );
  }, [authData, settings, currentPage]);

  // Query to fetch all listings for search (when search is active)
  const allListingsQuery = useMemo(() => {
    if (!authData || !settings || !searchQuery.trim()) return null;
    return buildGetAllUserMarketListingsQuery(
      authData.user._id,
      settings.mode === 'hardcore',
      settings.ladder === 'ladder',
      1000, // Fetch up to 1000 listings for search
      0
    );
  }, [authData, settings, searchQuery]);

  const fetchListings = useCallback(async () => {
    if (!marketQuery) return;
    
    setIsLoading(true);
    setError(null);
    try {
      const result = await getMarketListings(marketQuery);
      setListings(result.data);
      setTotalCount(result.total);
      // Update parent component if callbacks provided
      if (onTotalCountChange) {
        onTotalCountChange(result.total);
      }
      // Update parent's listings if on page 0
      if (currentPage === 0 && onListingsChange) {
        onListingsChange(result.data);
      }
    } catch (err) {
      console.error('Failed to fetch market listings:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch listings');
    } finally {
      setIsLoading(false);
    }
  }, [marketQuery, getMarketListings, onTotalCountChange, onListingsChange, currentPage]);

  // Fetch all listings when search query is entered
  useEffect(() => {
    const fetchAllForSearch = async () => {
      if (!allListingsQuery) {
        setAllListingsForSearch([]);
        return;
      }
      setIsLoadingAllListings(true);
      try {
        const result = await getMarketListings(allListingsQuery);
        setAllListingsForSearch(result.data);
      } catch (err) {
        console.error('Failed to fetch all listings for search:', err);
        setAllListingsForSearch([]);
      } finally {
        setIsLoadingAllListings(false);
      }
    };
    fetchAllForSearch();
  }, [allListingsQuery, getMarketListings]);

  useEffect(() => {
    // If searching, don't fetch paginated results
    if (searchQuery.trim()) {
      return;
    }
    // If we have initial data (even if empty) and we're on page 0, use it instead of fetching
    // This prevents infinite loops when there are no items
    if (currentPage === 0 && !hasInitialized && initialTotalCount !== undefined) {
      if (initialListings && initialListings.length > 0) {
        setListings(initialListings.slice(0, ITEMS_PER_PAGE));
      } else {
        // Empty initial listings - set empty state to prevent fetch loop
        setListings([]);
      }
      setTotalCount(initialTotalCount);
      setHasInitialized(true);
      return;
    }
    // Only fetch if we've initialized and we're not on the initial page
    // OR if we haven't initialized but we're not on page 0 (shouldn't happen, but safety check)
    if (marketQuery && hasInitialized && currentPage !== 0) {
      fetchListings();
    } else if (marketQuery && !hasInitialized && currentPage !== 0) {
      fetchListings();
    }
  }, [marketQuery, fetchListings, currentPage, initialListings, initialTotalCount, searchQuery, hasInitialized]);

  const handleBump = async (listing: MarketListingEntry) => {
    setBumpingListingId(listing._id);
    try {
      await updateMarketListing(listing._id, { bumped_at: new Date().toISOString() });
      await updateItemByHash(listing.item.hash, { bumped_at: new Date().toISOString() });
      await fetchListings();
      emit('toast-event', 'Item bumped successfully!');
    } catch (err) {
      console.error('Failed to bump item:', err);
      emit('toast-event', 'Failed to bump item');
    } finally {
      setBumpingListingId(null);
    }
  };

  const handleDelete = async (listing: MarketListingEntry) => {
    try {
      await deleteMarketListing(listing._id);
      await fetchListings();
      emit('toast-event', `Removed ${listing.item.name} market listing.`);
    } catch (err) {
      console.error('Failed to delete listing:', err);
      emit('toast-event', 'Failed to delete listing');
    }
  };

  const handleEdit = (listing: MarketListingEntry) => {
    setEditingListingId(listing._id);
    editForm.reset({
      type: listing.price.includes('obo') ? 'negotiable' :
            typeof listing.hr_price === 'number' && listing.hr_price > 0 ? 'exact' :
            'note',
      note: typeof listing.price === 'string' ? listing.price : '',
      price: listing.hr_price ?? '',
      currency: 'HR',
    });
  };

  const handleSaveEdit = async (values: ShortcutFormData, listing: MarketListingEntry) => {
    try {
      let updateFields: Record<string, any> = {};
      if (values.type === 'note') {
        updateFields.price = values.note;
      } else if (values.type === 'exact' || values.type === 'negotiable') {
        updateFields.hr_price = Number(values.price);
        updateFields.price = values.type === 'negotiable' ? 'obo' : values.note;
      }
      await updateMarketListing(listing._id, updateFields);
      await updateItemByHash(listing.item.hash, updateFields);
      setEditingListingId(null);
      await fetchListings();
      emit('toast-event', 'Listing updated!');
    } catch (err) {
      console.error('Failed to update listing:', err);
      emit('toast-event', 'Failed to update listing');
    }
  };

  const canBump = (listing: MarketListingEntry) => {
    if (!listing.bumped_at) return true;
    const lastBump = moment(listing.bumped_at);
    const now = moment();
    return now.diff(lastBump, 'hours') >= 12;
  };

  const timeUntilBump = (listing: MarketListingEntry) => {
    if (!listing.bumped_at) return '';
    const lastBump = moment(listing.bumped_at);
    const nextBump = lastBump.clone().add(12, 'hours');
    return nextBump.fromNow();
  };

  const toggleExpandedStats = (itemHash: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemHash)) {
      newExpanded.delete(itemHash);
    } else {
      newExpanded.add(itemHash);
    }
    setExpandedItems(newExpanded);
  };

  // Create Fuse instance for searching
  const fuse = useMemo(() => {
    const listingsToSearch = searchQuery.trim() ? allListingsForSearch : listings;
    return new Fuse(listingsToSearch, {
      keys: [
        'item.name',
        'item.base.name',
        'price',
        { name: 'hr_price', getFn: (listing) => listing.hr_price?.toString() || '' }
      ],
      threshold: 0.4, // 0 = exact match, 1 = match anything
      includeScore: true,
    });
  }, [allListingsForSearch, listings, searchQuery]);

  // Filter listings based on search query
  const filteredListings = useMemo(() => {
    if (!searchQuery.trim()) {
      return listings;
    }
    if (allListingsForSearch.length === 0) {
      return [];
    }
    const results = fuse.search(searchQuery);
    return results.map(result => result.item);
  }, [searchQuery, listings, allListingsForSearch, fuse]);

  const totalPages = Math.ceil((searchQuery.trim() ? filteredListings.length : totalCount) / ITEMS_PER_PAGE);
  
  // Paginate filtered results
  const paginatedListings = useMemo(() => {
    if (!searchQuery.trim()) {
      // When not searching, listings should already be paginated from the API
      // The API returns exactly ITEMS_PER_PAGE items per request
      return listings;
    }
    // When searching, paginate the filtered results
    const start = currentPage * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    return filteredListings.slice(start, end);
  }, [filteredListings, currentPage, searchQuery, listings]);

  if (isLoading && listings.length === 0 && !searchQuery.trim()) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="ml-2">Loading listings...</span>
      </div>
    );
  }

  if (error && listings.length === 0 && !searchQuery.trim()) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <p className="text-red-500 mb-4">{error}</p>
        <Button onClick={fetchListings}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center mb-2 gap-2">
      <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search item by name..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(0); // Reset to first page when searching
            }}
            className="pl-8 pr-8 h-8 text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setCurrentPage(0);
              }}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        <span className="text-xs font-medium">
          Listed Items ({searchQuery.trim() ? filteredListings.length : totalCount})
        </span>
      </div>

      {(isLoadingAllListings && searchQuery.trim()) && (
        <div className="flex items-center justify-center p-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="ml-2 text-sm text-muted-foreground">Searching...</span>
        </div>
      )}
      <ScrollArea className="flex-1 pr-2">
      
        <div className="flex flex-col gap-2 max-h-[20rem]">
          {paginatedListings.length === 0 && searchQuery.trim() && !isLoadingAllListings && (
            <div className="text-center text-sm text-muted-foreground p-4">
              No items found matching "{searchQuery}"
            </div>
          )}
          {paginatedListings.map((listing) => {
            const isEditing = editingListingId === listing._id;
            const itemHash = listing.item.hash;

            return (
              <div
                key={listing._id}
                className="p-3 border rounded border-neutral-600"
              >
                <div className="flex justify-between items-start gap-2 mb-2">
                  <div className="flex-1">
                    <div className={qualityColor(listing.item.quality.name)} style={{fontFamily: 'DiabloFont'}}>
                      {listing.item.name}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {listing.hr_price ? `${listing.hr_price} HR` : ''} {listing.price}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <Form {...editForm}>
                        <form
                          onSubmit={editForm.handleSubmit((values) => handleSaveEdit(values, listing))}
                          className="flex items-end gap-1"
                        >
                          <FormField
                            control={editForm.control}
                            name="type"
                            render={({ field }) => (
                              <FormItem className="m-0 p-0 min-w-50">
                                <FormControl>
                                  <Select value={field.value} onValueChange={field.onChange}>
                                    <SelectTrigger className="w-full h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {priceTypeOptions.map(opt => (
                                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          {editForm.watch('type') === 'note' ? (
                            <FormField
                              control={editForm.control}
                              name="note"
                              render={({ field }) => (
                                <FormItem className="m-0 p-0 min-w-0 w-32">
                                  <FormControl>
                                    <Input
                                      placeholder="Note..."
                                      {...field}
                                      className="h-8 text-xs"
                                      autoComplete="off"
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          ) : (
                            <FormField
                              control={editForm.control}
                              name="price"
                              render={({ field }) => (
                                <FormItem className="m-0 p-0 min-w-0 w-20">
                                  <FormControl>
                                    <Input
                                      type="number"
                                      min={0}
                                      step={0.01}
                                      placeholder="HR"
                                      {...field}
                                      className="h-8 text-xs"
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          )}
                          <ButtonGroup>
                          <Button type="submit" size="sm" className="h-8 text-xs">Save</Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs"
                            onClick={() => setEditingListingId(null)}
                          >
                            Cancel
                          </Button>
                          </ButtonGroup>
                          
                        </form>
                      </Form>
                    ) : (
                      <>
                        {canBump(listing) ? (
                          <Tooltip delayDuration={0}>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => handleBump(listing)}
                                disabled={bumpingListingId === listing._id}
                              >
                                {bumpingListingId === listing._id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  'Bump'
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Bump listing to top</TooltipContent>
                          </Tooltip>
                        ) : (
                          <Tooltip delayDuration={0}>
                            <TooltipTrigger asChild>
                              <span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs cursor-not-allowed"
                                  disabled
                                >
                                  Bump
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              You can bump this item {timeUntilBump(listing)}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip delayDuration={0}>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => handleEdit(listing)}
                            >
                              Edit
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit price</TooltipContent>
                        </Tooltip>
                        <Tooltip delayDuration={0}>
                          <TooltipTrigger asChild>
                            <Trash2
                              className="w-4 h-4 p-0 hover:opacity-70 transition-opacity cursor-pointer text-red-500"
                              onClick={() => handleDelete(listing)}
                            />
                          </TooltipTrigger>
                          <TooltipContent>Remove listing</TooltipContent>
                        </Tooltip>
                        <Tooltip delayDuration={0}>
                          <TooltipTrigger asChild>
                            <SquareArrowOutUpRight
                              className="w-4 h-4 p-0 hover:opacity-70 transition-opacity cursor-pointer"
                              onClick={() => openUrl(`${PD2Website.Website}/market/listing/${listing._id}`)}
                            />
                          </TooltipTrigger>
                          <TooltipContent>Go to trade website</TooltipContent>
                        </Tooltip>
                      </>
                    )}
                  </div>
                </div>
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => toggleExpandedStats(itemHash)}
                    className="text-xs text-blue-500 hover:text-blue-700 underline"
                  >
                    {expandedItems.has(itemHash) ? 'Show Less' : 'Show Stats'}
                  </button>
                  {expandedItems.has(itemHash) && (
                    <ItemStatsDisplay
                      stashItem={listing.item as any}
                      isExpanded={true}
                      onToggleExpanded={toggleExpandedStats}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {totalPages > 1 && (
        <div className="flex justify-between items-center mt-4 pt-2 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
            disabled={currentPage === 0 || isLoading || isLoadingAllListings}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {currentPage + 1} of {totalPages}
            {searchQuery.trim() && ` (${filteredListings.length} results)`}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
            disabled={currentPage >= totalPages - 1 || isLoading || isLoadingAllListings}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default ListedItemsTab;

