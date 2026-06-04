import { Text, View, useWindowDimensions } from 'react-native';
import { Button } from '@/components/ui/button';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';

type AmendmentReviewActionsProps = {
  saving: boolean;
  onBack: () => void;
  onSaveDraft: () => void;
  onPublish: () => void;
};

export function AmendmentReviewActions({
  saving,
  onBack,
  onSaveDraft,
  onPublish,
}: AmendmentReviewActionsProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;

  return (
    <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 gap-4">
      <View className="gap-1">
        <Text className="text-white font-instrument-semibold text-lg">Ready to publish?</Text>
        <Text className="text-gray-400 font-instrument text-sm">
          Save a draft to keep this amendment internal. Publishing emails the account owner; billing
          changes apply after they accept.
        </Text>
      </View>

      <View className="gap-3">
        <Button variant="outline" onPress={onBack} disabled={saving}>
          Back
        </Button>

        {isMobile ? (
          <>
            <Button variant="secondary" onPress={onSaveDraft} disabled={saving}>
              {saving ? 'Saving draft...' : 'Save draft'}
            </Button>
            <Button onPress={onPublish} disabled={saving}>
              {saving ? 'Publishing...' : 'Publish to owner'}
            </Button>
          </>
        ) : (
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button variant="secondary" fullWidth onPress={onSaveDraft} disabled={saving}>
                {saving ? 'Saving draft...' : 'Save draft'}
              </Button>
            </View>
            <View className="flex-1">
              <Button fullWidth onPress={onPublish} disabled={saving}>
                {saving ? 'Publishing...' : 'Publish to owner'}
              </Button>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}
