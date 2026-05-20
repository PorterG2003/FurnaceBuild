import { Text, TextInput, View, type TextInputProps } from 'react-native';
import { FormFieldLabel } from './FormFieldHelp';
import {
  FORM_FIELD_VARIANTS,
  type FormFieldVariant,
} from './formFieldStyles';

export interface FormTextFieldProps extends TextInputProps {
  label: string;
  /** Short explanation shown via help icon (web tooltip / native alert). */
  labelHelp?: string;
  hint?: string;
  variant?: FormFieldVariant;
  containerClassName?: string;
}

export function FormTextField({
  label,
  labelHelp,
  hint,
  variant = 'solid',
  containerClassName,
  className,
  style,
  placeholderTextColor,
  ...textInputProps
}: FormTextFieldProps) {
  const field = FORM_FIELD_VARIANTS[variant];

  return (
    <View className={containerClassName}>
      <FormFieldLabel label={label} labelClassName={field.labelClassName} help={labelHelp} />
      <TextInput
        className={className ?? field.inputClassName}
        style={[field.inputStyle, style]}
        placeholderTextColor={placeholderTextColor ?? field.placeholderTextColor}
        selectionColor="#FF4D00"
        underlineColorAndroid="transparent"
        {...textInputProps}
      />
      {hint ? <Text className={field.hintClassName}>{hint}</Text> : null}
    </View>
  );
}
