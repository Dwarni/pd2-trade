import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { X, GripVertical } from "lucide-react";
import { Item as PriceCheckItem } from '@/pages/price-check/lib/interfaces';
import { Item as GameStashItem } from '@/common/types/pd2-website/GameStashResponse';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { buildGetMarketListingByStashItemQuery } from '@/pages/price-check/lib/tradeUrlBuilder';
import { MarketListingEntry } from '@/common/types/pd2-website/GetMarketListingsResponse';
import { emit } from '@tauri-apps/api/event';
import { usePd2Website } from '@/hooks/pd2website/usePD2Website';
import { useOptions } from '@/hooks/useOptions';
import { CustomToastPayload, ToastActionType } from '@/common/types/Events';
import { shortcutFormSchema, ShortcutFormData } from './types';
import ItemSelectionList from './ItemSelectionList';
import ListingFormFields from './ListingFormFields';
import LoadingAndErrorStates from './LoadingAndErrorStates';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import ListedItemsTab from './ListedItemsTab';
import { Badge } from '@/components/ui/badge';
import { buildGetAllUserMarketListingsQuery } from '@/pages/price-check/lib/tradeUrlBuilder';
import { incrementMetric, distributionMetric } from '@/lib/sentryMetrics';

interface ListItemShortcutFormProps {
  item: PriceCheckItem | null;
}

const ListItemShortcutForm: React.FC<ListItemShortcutFormProps> = ({ item }) => {
  const { findMatchingItems, listSpecificItem, authData, getMarketListings, updateMarketListing, updateItemByHash, deleteMarketListing } = usePd2Website();
  const { settings } = useOptions();
  const [matchingItems, setMatchingItems] = useState<GameStashItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<GameStashItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentListings, setCurrentListings] = useState<MarketListingEntry[]>([]);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [isMarketListingsLoading, setIsMarketListingsLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [totalListingsCount, setTotalListingsCount] = useState<number>(0);
  const [allListings, setAllListings] = useState<MarketListingEntry[]>([]);
  
  const form = useForm<ShortcutFormData>({
    resolver: zodResolver(shortcutFormSchema),
    defaultValues: { type: 'exact', note: '', price: '', currency: 'HR' },
  });

  // Get the current window reference (Tauri v2 API)
  const appWindow = useMemo(() => getCurrentWebviewWindow(), []);

  // Window control handler
  const handleClose = useCallback(() => {
    appWindow.hide();
  }, [appWindow]);


  // Complete reset function for new items
  const resetAllState = useCallback(() => {
    setMatchingItems([]);
    setSelectedItem(null);
    setError(null);
    setCurrentListings([]);
    setExpandedItems(new Set());
    setIsMarketListingsLoading(false);
    setSubmitLoading(false);
    form.reset({ type: 'exact', note: '', price: '', currency: 'HR' });
  }, [form]);

  const findMatchingItemsInStash = useCallback(async () => {
    // Reset everything first when starting a new search
    resetAllState();
    
    setIsLoading(true);
    setError(null);
    const startTime = performance.now();
    try {
      const items = await findMatchingItems(item);
      const duration = performance.now() - startTime;
      
      // Track matching items found
      incrementMetric('list_item.matching_items.search', 1, { status: 'success' });
      distributionMetric('list_item.matching_items.count', items.length);
      distributionMetric('list_item.matching_items.search_duration_ms', duration);
      
      setMatchingItems(items);
      if (items.length === 1) {
        setSelectedItem(items[0]);
        incrementMetric('list_item.auto_selected', 1);
      } else {
        setSelectedItem(null);
      }
    } catch (err) {
      const duration = performance.now() - startTime;
      incrementMetric('list_item.matching_items.search', 1, { status: 'error' });
      distributionMetric('list_item.matching_items.search_duration_ms', duration);
      console.error(err instanceof Error ? err.message : 'Failed to find items');
      setError(err instanceof Error ? err.message : 'Failed to find items');
    } finally {
      setIsLoading(false);
    }
  }, [findMatchingItems, item, resetAllState]);

  // Find matching items when component mounts or item changes
  useEffect(() => {
    if (item && authData) {
      findMatchingItemsInStash();
    }
  }, [item, authData, findMatchingItemsInStash]);

  const pd2MarketQuery = useMemo(() => {
    if (!item || !authData || matchingItems.length === 0) return null;
    return buildGetMarketListingByStashItemQuery(matchingItems, authData.user._id);
  }, [matchingItems, authData, item]);

  const getMarketListingsForStashItems = useCallback(async () => {
    if (!pd2MarketQuery) return;
    
    setIsMarketListingsLoading(true);
    try {
      const result = await getMarketListings(pd2MarketQuery);
      if (result.data.length > 0) {
        setCurrentListings(result.data.map((item) => item));
      } else {
        setCurrentListings([]);
      }
    } catch (err) {
      console.error('Failed to fetch market listings:', err);
      setCurrentListings([]);
    } finally {
      setIsMarketListingsLoading(false);
    }
  }, [pd2MarketQuery, getMarketListings]);

  // Fetch market listings when pd2MarketQuery changes (after matching items are found)
  useEffect(() => {
    if (pd2MarketQuery) {
      getMarketListingsForStashItems();
    }
  }, [pd2MarketQuery, getMarketListingsForStashItems]);

  // Fetch all user listings for the badge and to pass to ListedItemsTab
  const allListingsQuery = useMemo(() => {
    if (!authData || !settings) return null;
    return buildGetAllUserMarketListingsQuery(
      authData.user._id,
      settings.mode === 'hardcore',
      settings.ladder === 'ladder',
      5, // Fetch first page (5 items to match ITEMS_PER_PAGE) to get both data and total count
      0
    );
  }, [authData, settings]);

  const fetchAllListings = useCallback(async () => {
    if (!allListingsQuery) return;
    try {
      const result = await getMarketListings(allListingsQuery);
      setAllListings(result.data);
      setTotalListingsCount(result.total);
    } catch (err) {
      console.error('Failed to fetch all listings:', err);
      setAllListings([]);
      setTotalListingsCount(0);
    }
  }, [allListingsQuery, getMarketListings]);

  useEffect(() => {
    fetchAllListings();
  }, [fetchAllListings]);

  const handleSubmit = async (values: ShortcutFormData) => {
    if (!selectedItem) {
      setError('Please select an item to list');
      incrementMetric('list_item.submit_attempt', 1, { status: 'validation_error', reason: 'no_item_selected' });
      return;
    }
    setSubmitLoading(true);
    const startTime = performance.now();
    try {
      // Determine type based on which fields are filled
      const hasPrice = values.price && Number(values.price) > 0;
      const hasNote = values.note && values.note.trim().length > 0;
      const listingType = hasPrice ? 'exact' : 'note';
      
      const isAlreadyListed = !!currentListingForSelected;
      if (isAlreadyListed) {
        // Prepare update fields
        let updateFields: Record<string, any> = {};
        if (listingType === 'note') {
          updateFields.price = values.note;
          updateFields.hr_price = 0;
        } else if (listingType === 'exact') {
          updateFields.hr_price = Number(values.price);
          updateFields.price = values.note || '';
        }
        await updateMarketListing(currentListingForSelected._id, updateFields);
        await updateItemByHash(selectedItem.hash, updateFields);
        await fetchAllListings(); // Refresh all listings
        await emit('toast-event', 'Listing updated!');
        
        const duration = performance.now() - startTime;
        incrementMetric('list_item.update', 1, { status: 'success', listing_type: listingType });
        distributionMetric('list_item.update_duration_ms', duration);
        if (hasPrice) {
          distributionMetric('list_item.update_price_hr', Number(values.price));
        }
        
        appWindow.hide();
      } else {
        const listing = await listSpecificItem(selectedItem, hasPrice ? Number(values.price) : 0, values.note || '', listingType);
        form.reset({ type: 'exact', note: '', price: '', currency: 'HR' });
        
        const duration = performance.now() - startTime;
        incrementMetric('list_item.create', 1, { status: 'success', listing_type: listingType });
        distributionMetric('list_item.create_duration_ms', duration);
        if (hasPrice) {
          distributionMetric('list_item.create_price_hr', Number(values.price));
        }
        
        // Emit custom toast with listing data
        const toastPayload: CustomToastPayload = {
          title: 'Item listed!',
          description: `Added to the PD2 marketplace.`,
          action: {
            label: selectedItem?.name || 'Go to listing',
            type: ToastActionType.OPEN_MARKET_LISTING,
            data: {
              listingId: listing._id
            }
          }
        };
        
        await emit('toast-event', toastPayload);
        await fetchAllListings(); // Refresh all listings
        appWindow.hide();
      }
    } catch (err) {
      const duration = performance.now() - startTime;
      const isAlreadyListed = !!currentListingForSelected;
      const action = isAlreadyListed ? 'update' : 'create';
      incrementMetric(`list_item.${action}`, 1, { status: 'error' });
      distributionMetric(`list_item.${action}_duration_ms`, duration);
      console.error(err instanceof Error ? err.message : 'Failed to list/update item');
      setError(err instanceof Error ? err.message : 'Failed to list/update item');
    } finally {
      setSubmitLoading(false);
    }
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

  const expandAllStats = () => {
    const allHashes = matchingItems.map(item => item.hash).filter(Boolean);
    setExpandedItems(new Set(allHashes));
  };

  const collapseAllStats = () => {
    setExpandedItems(new Set());
  };

  const handleBump = async (marketId: string, itemHash: string) => {
    const startTime = performance.now();
    try {
      await updateMarketListing(marketId, { bumped_at: new Date().toISOString() });
      await updateItemByHash(itemHash, { bumped_at: new Date().toISOString() });
      const duration = performance.now() - startTime;
      incrementMetric('list_item.bump', 1, { status: 'success', source: 'list_item_shortcut' });
      distributionMetric('list_item.bump_duration_ms', duration);
    } catch (err) {
      const duration = performance.now() - startTime;
      incrementMetric('list_item.bump', 1, { status: 'error', source: 'list_item_shortcut' });
      distributionMetric('list_item.bump_duration_ms', duration);
      throw err;
    }
  };

  const handleRefresh = async () => {
    incrementMetric('list_item.refresh', 1);
    await getMarketListingsForStashItems();
    await findMatchingItemsInStash();
  };

  // Find the current market listing for the selected item
  const currentListingForSelected = useMemo(() => 
    selectedItem ? currentListings.find((c) => c.item.hash === selectedItem.hash) : undefined,
    [selectedItem, currentListings]
  );

  // Prepopulate form fields when selecting a listed item
  useEffect(() => {
    if (!selectedItem || !item) return;
  
    const resetValues: ShortcutFormData = currentListingForSelected
      ? { 
          type: typeof currentListingForSelected.hr_price === 'number' && currentListingForSelected.hr_price > 0  ? 'exact' : 'note',
          note: typeof currentListingForSelected.price === 'string' ? currentListingForSelected.price : '',
          price: currentListingForSelected.hr_price ?? '',
          currency: 'HR',
        }
      : { type: 'exact', note: '', price: '', currency: 'HR' };
  
    form.reset(resetValues);
  }, [selectedItem, currentListingForSelected, form, item]);

  // If no item is provided, show only the Listed Items tab
  if (!item) {
    return (
      <div className="inline-block p-4 border rounded-lg bg-background shadow w-screen h-screen">
        <div className="flex justify-between mb-2 items-center" id="titlebar">
          <div className="flex items-center gap-1">
            <GripVertical 
              data-tauri-drag-region
              className="h-4 w-4 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground" 
              id="titlebar-drag-handle"
            />
            <span style={{fontFamily: 'DiabloFont'}} className="mt-1">Listed Items</span>
          </div>
          <Button 
            type="button" 
            id="titlebar-close"
            className="h-6 w-6" 
            variant='ghost' 
            onClick={handleClose}
          >
            <X className='h-4 w-4'/>
          </Button>
        </div>
        <ListedItemsTab onClose={handleClose} />
      </div>
    );
  }

  // Check for loading/error states first
  if (isLoading || error || matchingItems.length === 0) {
    return (
      <LoadingAndErrorStates
        isLoading={isLoading}
        error={error}
        matchingItems={matchingItems}
        item={item}
        onRetry={findMatchingItemsInStash}
      />
    );
  }

  return (
    <div className="inline-block p-4 border rounded-lg bg-background shadow w-screen h-screen">

      <Tabs defaultValue="list-item" className="w-full">
      <div className="flex justify-between mb-2 items-center" id="titlebar">
        <div className="flex items-center gap-1">
            <GripVertical 
              data-tauri-drag-region
              className="h-4 w-4 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground" 
              id="titlebar-drag-handle"
            />
            <TabsList>
              <TabsTrigger value="list-item" className="font-bold" style={{fontFamily: 'DiabloFont'}}>List Item</TabsTrigger>
              <TabsTrigger value="listed-items" className="font-bold" >
                <span className="font-bold" style={{fontFamily: 'DiabloFont'}}>Manage</span>
                {totalListingsCount > 0 && <Badge className="font-bold text-xs rounded-full">{totalListingsCount}</Badge>}
              </TabsTrigger>
            </TabsList>  
          </div>
      
          <Button 
            type="button" 
            id="titlebar-close"
            className="h-6 w-6" 
            variant='ghost' 
            onClick={handleClose}
          >
            <X className='h-4 w-4'/>
          </Button>
        </div>
        
        <TabsContent value="list-item" className="mt-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)}>
              <ItemSelectionList
                deleteMarketListing={deleteMarketListing}
                matchingItems={matchingItems}
                selectedItem={selectedItem}
                currentListings={currentListings}
                expandedItems={expandedItems}
                isMarketListingsLoading={isMarketListingsLoading}
                onItemSelect={setSelectedItem}
                onToggleExpanded={toggleExpandedStats}
                onExpandAll={expandAllStats}
                onCollapseAll={collapseAllStats}
                onBump={handleBump}
                onRefresh={handleRefresh}
              />

              <ListingFormFields
                form={form}
                selectedItem={selectedItem}
                currentListings={currentListings}
                submitLoading={submitLoading}
                onSubmit={handleSubmit}
              />
            </form>
          </Form>
        </TabsContent>

        <TabsContent value="listed-items" className="mt-4">
          <ListedItemsTab 
            onClose={handleClose} 
            initialListings={allListings}
            initialTotalCount={totalListingsCount}
            onTotalCountChange={setTotalListingsCount}
            onListingsChange={setAllListings}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ListItemShortcutForm; 