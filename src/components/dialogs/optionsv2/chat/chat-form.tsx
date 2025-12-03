import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import React from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOptions } from '@/hooks/useOptions';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { emit } from '@tauri-apps/api/event';

const chatFormSchema = z.object({
  whisperNotificationsEnabled: z.boolean().optional(),
  whisperIgnoreList: z.array(z.string()).optional(),
});

type ChatFormValues = z.infer<typeof chatFormSchema>;

export function ChatForm() {
  const { settings, isLoading, updateSettings } = useOptions();
  const [saving, setSaving] = React.useState(false);
  const [newIgnorePlayer, setNewIgnorePlayer] = React.useState('');

  const form = useForm<ChatFormValues>({
    resolver: zodResolver(chatFormSchema),
    defaultValues: {
      whisperNotificationsEnabled: settings?.whisperNotificationsEnabled ?? true,
      whisperIgnoreList: settings?.whisperIgnoreList || [],
    },
  });

  // Reset form when settings change
  React.useEffect(() => {
    if (settings) {
      form.reset({
        whisperNotificationsEnabled: settings.whisperNotificationsEnabled ?? true,
        whisperIgnoreList: settings.whisperIgnoreList || [],
      });
    }
  }, [settings, form]);

  const ignoreList = form.watch('whisperIgnoreList') || [];

  const addToIgnoreList = () => {
    const playerName = newIgnorePlayer.trim().toLowerCase();
    if (playerName && !ignoreList.includes(playerName)) {
      const updatedList = [...ignoreList, playerName];
      form.setValue('whisperIgnoreList', updatedList);
      setNewIgnorePlayer('');
    }
  };

  const removeFromIgnoreList = (playerName: string) => {
    const updatedList = ignoreList.filter((name) => name !== playerName);
    form.setValue('whisperIgnoreList', updatedList);
  };

  if (isLoading || !settings) {
    return null;
  }

  const onSubmit = async (values: ChatFormValues) => {
    setSaving(true);
    await updateSettings(values);
    await new Promise((resolve) => setTimeout(resolve, 200)); // artificial delay
    setSaving(false);
    emit('toast-event', 'Chat preferences saved!');
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-y-4">
        <FormField
          control={form.control}
          name="whisperNotificationsEnabled"
          render={({ field }) => (
            <FormItem>
              <div className="flex flex-row items-center gap-2">
                <FormLabel>Whisper Notifications</FormLabel>
                <FormControl>
                  <Switch
                    checked={field.value ?? true}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </div>
              <FormDescription>
                Play a notification sound when you receive whispers in-game.
              </FormDescription>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="whisperIgnoreList"
          render={() => (
            <FormItem>
              <FormLabel>Ignore List</FormLabel>
              <FormControl>
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enter player name to ignore"
                      value={newIgnorePlayer}
                      onChange={(e) => setNewIgnorePlayer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addToIgnoreList();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={addToIgnoreList}
                      disabled={!newIgnorePlayer.trim()}
                    >
                      Add
                    </Button>
                  </div>
                  {ignoreList.length > 0 && (
                    <div className="flex flex-wrap gap-2 p-2 border rounded-md min-h-[60px]">
                      {ignoreList.map((playerName) => (
                        <Badge
                          key={playerName}
                          variant="secondary"
                          className="flex items-center gap-1 px-2 py-1"
                        >
                          {playerName}
                          <button
                            type="button"
                            onClick={() => removeFromIgnoreList(playerName)}
                            className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </FormControl>
              <FormDescription>
                Players in this list will not trigger whisper notifications.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit"
          className={'self-start cursor-pointer mt-2'}
          disabled={saving}
        >
          {saving ? <Loader2 className="animate-spin mr-2" /> : null}
          {saving ? 'Saving...' : 'Update chat preferences'}
        </Button>
      </form>
    </Form>
  );
}

