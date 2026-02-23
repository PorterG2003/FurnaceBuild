import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, Platform, Modal, TouchableOpacity } from 'react-native';
import Animated, { useAnimatedStyle, withTiming, useSharedValue, Easing } from 'react-native-reanimated';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { useRouter, usePathname } from 'expo-router';
import { SvgXml } from 'react-native-svg';
import { DocumentTextIcon, ArrowRightOnRectangleIcon, Cog6ToothIcon, InboxIcon, EnvelopeIcon, ChevronDownIcon } from 'react-native-heroicons/outline';
import { useAccount } from '@/contexts/AccountContext';

const furnaceLogoFull = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg height="100%" stroke-miterlimit="10" style="fill-rule:nonzero;clip-rule:evenodd;stroke-linecap:round;stroke-linejoin:round;" version="1.1" viewBox="0 0 1584 396" width="100%" xml:space="preserve" xmlns="http://www.w3.org/2000/svg">
<defs/>
<g id="Layer-1">
<g opacity="1">
<path d="M390.215 87.1396C390.579 87.1396 393.453 90.7627 394.511 92.5787C394.808 93.0827 395.107 93.5869 395.416 94.1062C400.811 103.418 402.472 113.099 400.308 123.637C398.646 129.854 396.092 134.94 391.877 139.798C391.35 140.415 391.35 140.415 390.811 141.043C387.632 144.491 383.967 146.733 379.929 149.009C378.393 149.878 376.866 150.761 375.338 151.646C372.25 153.436 369.156 155.218 366.061 156.997C363.026 158.744 359.99 160.496 356.956 162.247C353.341 164.334 349.725 166.419 346.109 168.503C339.707 172.192 333.315 175.896 326.939 179.632C323.643 181.558 320.326 183.443 316.992 185.303C304.725 192.155 293.651 198.805 288.223 212.411C288.019 213.145 287.824 213.883 287.668 214.629C287.303 214.629 274.054 191.532 277.449 177.664C282.017 162.639 291.984 155.669 305.057 148.483C308.498 146.59 311.894 144.629 315.28 142.639C320.1 139.811 324.94 137.021 329.796 134.255C334.673 131.477 339.537 128.675 344.38 125.837C348.724 123.292 353.088 120.788 357.476 118.319C359.521 117.166 361.565 116.011 363.608 114.855C364.283 114.473 364.283 114.473 364.971 114.084C375.34 108.193 386.002 101.57 389.66 89.4607C389.857 88.6898 390.045 87.917 390.215 87.1396Z" fill="#f85102" fill-rule="nonzero" opacity="1" stroke="none"/>
<path d="M392.986 153.656C393.352 153.656 399.176 161.064 401.084 168.57C402.884 174.894 402.467 182.468 400.191 188.577C400.037 189.028 399.883 189.479 399.724 189.943C395.54 201.358 388.196 207.41 377.957 213.171C376.279 214.118 374.611 215.083 372.944 216.05C370.522 217.455 368.099 218.854 365.672 220.248C363.202 221.665 360.734 223.087 358.27 224.514C357.368 225.036 357.368 225.036 356.446 225.568C355.244 226.265 354.04 226.961 352.836 227.657C349.925 229.339 347.006 231.003 344.067 232.634C338.123 235.931 332.385 239.26 327.024 243.453C326.33 243.974 326.33 243.974 325.623 244.507C320.226 248.871 316.754 255.15 314.829 261.745C314.463 261.745 311.592 257.913 310.533 255.994C310.235 255.458 309.936 254.923 309.628 254.371C304.072 244.277 302.125 234.375 305.196 223.096C309.032 210.458 318.715 203.34 329.83 197.134C330.509 196.75 331.19 196.367 331.869 195.982C332.914 195.391 333.961 194.8 335.008 194.21C338.539 192.22 342.05 190.192 345.559 188.161C349.85 185.682 354.144 183.207 358.446 180.747C358.909 180.482 359.373 180.216 359.85 179.943C362.384 178.494 364.927 177.064 367.483 175.652C373.141 172.519 378.578 169.448 383.562 165.296C383.966 164.982 384.369 164.667 384.787 164.343C388.195 161.58 392.227 157.977 392.986 153.656Z" fill="#f33203" fill-rule="nonzero" opacity="1" stroke="none"/>
<path d="M381.899 230.149C386.251 233.942 387.017 240.811 387.442 246.224C388.098 257.058 384.327 266.379 377.327 274.562C373.279 278.919 368.331 281.648 363.237 284.598C359.868 286.565 356.707 288.719 353.63 291.123C353.269 291.392 352.908 291.663 352.535 291.94C347.341 296.037 343.81 302.577 341.99 308.86C341.624 308.86 328.739 285.9 332.257 271.731C336.704 255.647 348.785 249.08 362.409 241.353C367.212 238.629 371.986 235.853 376.751 233.062C377.268 232.758 377.785 232.456 378.318 232.143C378.771 231.878 379.225 231.612 379.69 231.338C380.415 230.92 381.151 230.523 381.899 230.149Z" fill="#ea1b04" fill-rule="nonzero" opacity="1" stroke="none"/>
</g>
<g opacity="1">
<path d="M504.425 119.127L607.008 119.127L607.008 139.874L526.555 139.874L526.555 191.051L601.475 191.051L601.475 211.798L526.555 211.798L526.555 282.338L504.425 282.338L504.425 119.127Z" fill="#f33203" fill-rule="nonzero" opacity="1" stroke="#f33203" stroke-linecap="butt" stroke-linejoin="round" stroke-width="3.01"/>
<path d="M728.263 282.338L707.516 282.338L707.516 265.51L707.055 265.51C704.443 271.349 699.909 276.075 693.454 279.687C687 283.299 679.547 285.104 671.094 285.104C665.715 285.104 660.644 284.297 655.879 282.684C651.114 281.07 646.928 278.573 643.315 275.192C639.703 271.81 636.822 267.469 634.671 262.167C632.52 256.865 631.444 250.602 631.444 243.379L631.444 173.07L652.191 173.07L652.191 237.616C652.191 242.688 652.882 247.029 654.265 250.641C655.648 254.253 657.493 257.172 659.798 259.401C662.103 261.63 664.754 263.243 667.751 264.242C670.748 265.24 673.86 265.74 677.087 265.74C681.391 265.74 685.386 265.049 689.074 263.665C692.763 262.282 695.99 260.092 698.756 257.095C701.523 254.099 703.674 250.295 705.211 245.685C706.748 241.074 707.516 235.618 707.516 229.317L707.516 173.07L728.263 173.07L728.263 282.338Z" fill="#f33203" fill-rule="nonzero" opacity="1" stroke="#f33203" stroke-linecap="butt" stroke-linejoin="round" stroke-width="3.01"/>
<path d="M759.614 173.07L780.362 173.07L780.362 189.898L780.823 189.898C782.206 186.978 784.05 184.327 786.355 181.945C788.66 179.563 791.235 177.526 794.078 175.836C796.92 174.146 800.032 172.801 803.414 171.802C806.795 170.803 810.175 170.303 813.557 170.303C816.938 170.303 820.012 170.765 822.778 171.687L821.856 194.047C820.166 193.586 818.474 193.202 816.784 192.895C815.094 192.587 813.403 192.434 811.713 192.434C801.57 192.434 793.808 195.277 788.43 200.963C783.052 206.649 780.362 215.486 780.362 227.473L780.362 282.338L759.614 282.338L759.614 173.07Z" fill="#f33203" fill-rule="nonzero" opacity="1" stroke="#f33203" stroke-linecap="butt" stroke-linejoin="round" stroke-width="3.01"/>
<path d="M844.908 173.07L865.655 173.07L865.655 189.898L866.116 189.898C868.728 184.058 873.262 179.332 879.717 175.721C886.172 172.109 893.625 170.303 902.078 170.303C907.304 170.303 912.336 171.11 917.177 172.724C922.018 174.338 926.244 176.835 929.856 180.216C933.468 183.597 936.349 187.939 938.501 193.241C940.652 198.543 941.728 204.805 941.728 212.028L941.728 282.338L920.981 282.338L920.981 217.791C920.981 212.72 920.289 208.379 918.906 204.767C917.523 201.155 915.679 198.235 913.373 196.007C911.068 193.778 908.417 192.165 905.42 191.166C902.424 190.167 899.312 189.667 896.084 189.667C891.781 189.667 887.785 190.359 884.097 191.742C880.409 193.125 877.181 195.315 874.415 198.312C871.649 201.309 869.498 205.112 867.96 209.723C866.423 214.333 865.655 219.79 865.655 226.09L865.655 282.338L844.908 282.338L844.908 173.07Z" fill="#f33203" fill-rule="nonzero" opacity="1" stroke="#f33203" stroke-linecap="butt" stroke-linejoin="round" stroke-width="3.01"/>
<path d="M973.54 186.44C979.379 181.061 986.143 177.027 993.826 174.338C1001.51 171.648 1009.19 170.303 1016.88 170.303C1024.87 170.303 1031.75 171.302 1037.51 173.3C1043.27 175.298 1048 177.988 1051.69 181.369C1055.38 184.75 1058.1 188.63 1059.87 193.01C1061.64 197.39 1062.52 201.962 1062.52 206.726L1062.52 262.513C1062.52 266.355 1062.6 269.89 1062.75 273.117C1062.91 276.344 1063.14 279.417 1063.44 282.338L1045 282.338C1044.54 276.805 1044.31 271.273 1044.31 265.74L1043.85 265.74C1039.24 272.81 1033.78 277.804 1027.48 280.724C1021.18 283.645 1013.88 285.104 1005.58 285.104C1000.51 285.104 995.67 284.413 991.06 283.029C986.449 281.646 982.415 279.572 978.957 276.805C975.5 274.039 972.772 270.62 970.774 266.547C968.775 262.474 967.777 257.748 967.777 252.37C967.777 245.3 969.352 239.384 972.503 234.619C975.654 229.855 979.956 225.975 985.412 222.978C990.868 219.981 997.245 217.83 1004.55 216.523C1011.85 215.217 1019.64 214.564 1027.94 214.564L1043.16 214.564L1043.16 209.953C1043.16 207.187 1042.62 204.421 1041.54 201.655C1040.47 198.888 1038.85 196.391 1036.7 194.163C1034.55 191.934 1031.86 190.167 1028.64 188.861C1025.41 187.554 1021.57 186.901 1017.11 186.901C1013.11 186.901 1009.62 187.285 1006.62 188.054C1003.62 188.822 1000.9 189.783 998.437 190.935C995.977 192.088 993.75 193.433 991.751 194.969C989.753 196.506 987.832 197.966 985.988 199.349L973.54 186.44ZM1032.09 229.778C1027.18 229.778 1022.14 230.048 1016.99 230.585C1011.85 231.123 1007.16 232.16 1002.93 233.697C998.706 235.235 995.248 237.386 992.558 240.152C989.868 242.918 988.524 246.452 988.524 250.756C988.524 257.057 990.638 261.591 994.863 264.357C999.089 267.123 1004.81 268.506 1012.04 268.506C1017.72 268.506 1022.57 267.545 1026.56 265.625C1030.56 263.704 1033.78 261.206 1036.24 258.133C1038.7 255.06 1040.47 251.639 1041.54 247.875C1042.62 244.11 1043.16 240.383 1043.16 236.694L1043.16 229.778L1032.09 229.778Z" fill="#f33203" fill-rule="nonzero" opacity="1" stroke="#f33203" stroke-linecap="butt" stroke-linejoin="round" stroke-width="3.01"/>
<path d="M1170.87 202.116C1167.03 198.12 1162.99 195.085 1158.77 193.01C1154.54 190.935 1149.51 189.898 1143.67 189.898C1137.98 189.898 1133.02 190.935 1128.8 193.01C1124.57 195.085 1121.04 197.928 1118.19 201.539C1115.35 205.151 1113.2 209.301 1111.74 213.988C1110.28 218.674 1109.55 223.554 1109.55 228.626C1109.55 233.697 1110.39 238.499 1112.08 243.034C1113.77 247.568 1116.16 251.524 1119.23 254.906C1122.3 258.287 1125.99 260.938 1130.3 262.859C1134.6 264.779 1139.44 265.74 1144.82 265.74C1150.66 265.74 1155.65 264.703 1159.8 262.628C1163.95 260.553 1167.79 257.518 1171.33 253.522L1186.08 268.276C1180.7 274.269 1174.44 278.573 1167.29 281.185C1160.15 283.797 1152.58 285.104 1144.59 285.104C1136.14 285.104 1128.41 283.721 1121.42 280.955C1114.43 278.188 1108.4 274.308 1103.32 269.313C1098.25 264.318 1094.33 258.324 1091.57 251.332C1088.8 244.34 1087.42 236.618 1087.42 228.165C1087.42 219.712 1088.8 211.952 1091.57 204.882C1094.33 197.813 1098.21 191.742 1103.21 186.671C1108.2 181.599 1114.2 177.642 1121.19 174.799C1128.18 171.956 1135.98 170.534 1144.59 170.534C1152.58 170.534 1160.22 171.956 1167.53 174.799C1174.83 177.642 1181.17 181.983 1186.54 187.823L1170.87 202.116Z" fill="#f33203" fill-rule="nonzero" opacity="1" stroke="#f33203" stroke-linecap="butt" stroke-linejoin="round" stroke-width="3.01"/>
<path d="M1219.51 235.311C1219.51 240.076 1220.55 244.417 1222.62 248.336C1224.7 252.255 1227.42 255.597 1230.8 258.363C1234.19 261.13 1238.1 263.281 1242.56 264.818C1247.02 266.355 1251.63 267.123 1256.39 267.123C1262.85 267.123 1268.46 265.625 1273.22 262.628C1277.98 259.631 1282.36 255.673 1286.36 250.756L1302.04 262.743C1290.51 277.651 1274.37 285.104 1253.63 285.104C1245.02 285.104 1237.22 283.645 1230.23 280.724C1223.24 277.804 1217.32 273.769 1212.48 268.622C1207.64 263.474 1203.91 257.402 1201.3 250.41C1198.68 243.418 1197.38 235.848 1197.38 227.704C1197.38 219.559 1198.8 211.989 1201.64 204.997C1204.49 198.005 1208.4 191.934 1213.4 186.786C1218.39 181.638 1224.35 177.603 1231.27 174.683C1238.18 171.763 1245.71 170.303 1253.86 170.303C1263.54 170.303 1271.72 171.994 1278.41 175.375C1285.09 178.756 1290.59 183.174 1294.89 188.63C1299.19 194.086 1302.31 200.233 1304.23 207.072C1306.15 213.911 1307.11 220.864 1307.11 227.934L1307.11 235.311L1219.51 235.311ZM1284.98 218.713C1284.82 214.103 1284.09 209.877 1282.79 206.035C1281.48 202.192 1279.52 198.85 1276.91 196.007C1274.3 193.164 1271.03 190.935 1267.11 189.322C1263.19 187.708 1258.62 186.901 1253.4 186.901C1248.32 186.901 1243.67 187.862 1239.45 189.783C1235.22 191.704 1231.65 194.201 1228.73 197.275C1225.81 200.348 1223.54 203.768 1221.93 207.533C1220.32 211.298 1219.51 215.025 1219.51 218.713L1284.98 218.713Z" fill="#f33203" fill-rule="nonzero" opacity="1" stroke="#f33203" stroke-linecap="butt" stroke-linejoin="round" stroke-width="3.01"/>
</g>
</g>
</svg>`;

// Icon-only version (cropped to just the flame icon)
const furnaceLogoIcon = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg height="100%" stroke-miterlimit="10" style="fill-rule:nonzero;clip-rule:evenodd;stroke-linecap:round;stroke-linejoin:round;" version="1.1" viewBox="270 0 150 396" width="100%" xml:space="preserve" xmlns="http://www.w3.org/2000/svg">
<defs/>
<g id="Layer-1">
<g opacity="1">
<path d="M390.215 87.1396C390.579 87.1396 393.453 90.7627 394.511 92.5787C394.808 93.0827 395.107 93.5869 395.416 94.1062C400.811 103.418 402.472 113.099 400.308 123.637C398.646 129.854 396.092 134.94 391.877 139.798C391.35 140.415 391.35 140.415 390.811 141.043C387.632 144.491 383.967 146.733 379.929 149.009C378.393 149.878 376.866 150.761 375.338 151.646C372.25 153.436 369.156 155.218 366.061 156.997C363.026 158.744 359.99 160.496 356.956 162.247C353.341 164.334 349.725 166.419 346.109 168.503C339.707 172.192 333.315 175.896 326.939 179.632C323.643 181.558 320.326 183.443 316.992 185.303C304.725 192.155 293.651 198.805 288.223 212.411C288.019 213.145 287.824 213.883 287.668 214.629C287.303 214.629 274.054 191.532 277.449 177.664C282.017 162.639 291.984 155.669 305.057 148.483C308.498 146.59 311.894 144.629 315.28 142.639C320.1 139.811 324.94 137.021 329.796 134.255C334.673 131.477 339.537 128.675 344.38 125.837C348.724 123.292 353.088 120.788 357.476 118.319C359.521 117.166 361.565 116.011 363.608 114.855C364.283 114.473 364.283 114.473 364.971 114.084C375.34 108.193 386.002 101.57 389.66 89.4607C389.857 88.6898 390.045 87.917 390.215 87.1396Z" fill="#f85102" fill-rule="nonzero" opacity="1" stroke="none"/>
<path d="M392.986 153.656C393.352 153.656 399.176 161.064 401.084 168.57C402.884 174.894 402.467 182.468 400.191 188.577C400.037 189.028 399.883 189.479 399.724 189.943C395.54 201.358 388.196 207.41 377.957 213.171C376.279 214.118 374.611 215.083 372.944 216.05C370.522 217.455 368.099 218.854 365.672 220.248C363.202 221.665 360.734 223.087 358.27 224.514C357.368 225.036 357.368 225.036 356.446 225.568C355.244 226.265 354.04 226.961 352.836 227.657C349.925 229.339 347.006 231.003 344.067 232.634C338.123 235.931 332.385 239.26 327.024 243.453C326.33 243.974 326.33 243.974 325.623 244.507C320.226 248.871 316.754 255.15 314.829 261.745C314.463 261.745 311.592 257.913 310.533 255.994C310.235 255.458 309.936 254.923 309.628 254.371C304.072 244.277 302.125 234.375 305.196 223.096C309.032 210.458 318.715 203.34 329.83 197.134C330.509 196.75 331.19 196.367 331.869 195.982C332.914 195.391 333.961 194.8 335.008 194.21C338.539 192.22 342.05 190.192 345.559 188.161C349.85 185.682 354.144 183.207 358.446 180.747C358.909 180.482 359.373 180.216 359.85 179.943C362.384 178.494 364.927 177.064 367.483 175.652C373.141 172.519 378.578 169.448 383.562 165.296C383.966 164.982 384.369 164.667 384.787 164.343C388.195 161.58 392.227 157.977 392.986 153.656Z" fill="#f33203" fill-rule="nonzero" opacity="1" stroke="none"/>
<path d="M381.899 230.149C386.251 233.942 387.017 240.811 387.442 246.224C388.098 257.058 384.327 266.379 377.327 274.562C373.279 278.919 368.331 281.648 363.237 284.598C359.868 286.565 356.707 288.719 353.63 291.123C353.269 291.392 352.908 291.663 352.535 291.94C347.341 296.037 343.81 302.577 341.99 308.86C341.624 308.86 328.739 285.9 332.257 271.731C336.704 255.647 348.785 249.08 362.409 241.353C367.212 238.629 371.986 235.853 376.751 233.062C377.268 232.758 377.785 232.456 378.318 232.143C378.771 231.878 379.225 231.612 379.69 231.338C380.415 230.92 381.151 230.523 381.899 230.149Z" fill="#ea1b04" fill-rule="nonzero" opacity="1" stroke="none"/>
</g>
</g>
</svg>`;

// Module-level variable to persist expanded state across route changes and remounts
let persistedExpandedState = false;

export function NavBar() {
  const { signOut, user } = useAuthenticator();
  const { account, memberships, setCurrentAccountId } = useAccount();
  const router = useRouter();
  const pathname = usePathname();
  const [switcherVisible, setSwitcherVisible] = useState(false);
  // Use persisted state, but allow local state to control animations
  const [isExpanded, setIsExpanded] = useState(persistedExpandedState);
  const hasMultipleAccounts = memberships.length > 1;

  // Animated width values: collapsed = 56px (square buttons), expanded = 224px
  // Padding values: px-2 = 8px, px-4 = 16px
  // Initialize to match persisted expanded state
  const width = useSharedValue(persistedExpandedState ? 224 : 56);
  const paddingHorizontal = useSharedValue(persistedExpandedState ? 16 : 8);

  // Track if this is a route change (no animation) vs user interaction (with animation)
  const isRouteChangeRef = useRef(false);

  // Ensure state and animated values stay in sync with persisted value on route changes
  useEffect(() => {
    if (isExpanded !== persistedExpandedState) {
      isRouteChangeRef.current = true;
      setIsExpanded(persistedExpandedState);
    }
  }, [pathname, isExpanded]);

  // Animate based on isExpanded state, but skip animation on route changes
  useEffect(() => {
    const targetWidth = isExpanded ? 224 : 56;
    const targetPadding = isExpanded ? 16 : 8;
    
    if (isRouteChangeRef.current) {
      // Route change: set immediately without animation
      width.value = targetWidth;
      paddingHorizontal.value = targetPadding;
      isRouteChangeRef.current = false;
    } else {
      // User interaction: animate smoothly with easing
      const animationConfig = {
        duration: 300,
        easing: Easing.out(Easing.cubic),
      };
      width.value = withTiming(targetWidth, animationConfig);
      paddingHorizontal.value = withTiming(targetPadding, animationConfig);
    }
  }, [isExpanded, width, paddingHorizontal]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      width: width.value,
      paddingLeft: paddingHorizontal.value,
      paddingRight: paddingHorizontal.value,
      paddingVertical: 24, // py-6 = 24px (1.5rem)
      backgroundColor: '#1A1A1A',
      borderRightWidth: 1,
      borderRightColor: '#2A2A2A',
    };
  });

  const navItems = [
    { label: 'Campaigns', path: '/campaigns', icon: DocumentTextIcon },
    { label: 'Master Inbox', path: '/inbox', icon: InboxIcon },
    { label: 'Senders', path: '/senders', icon: EnvelopeIcon },
  ];

  const isActive = (path: string) => {
    if (path === '/campaigns') {
      return pathname === '/campaigns' || pathname === '/';
    }
    if (path === '/senders') {
      return pathname === '/senders' || pathname?.startsWith('/senders/');
    }
    return pathname === path;
  };

  const navRef = useRef<View>(null);

  const mouseProps = Platform.OS === 'web' ? {
    onMouseEnter: () => {
      persistedExpandedState = true;
      setIsExpanded(true);
    },
    onMouseLeave: (e: any) => {
      const ne = e?.nativeEvent;
      const clientX = ne?.clientX ?? 0;
      const clientY = ne?.clientY ?? 0;
      const relatedTarget = ne?.relatedTarget;
      const el = (navRef.current as any) as HTMLElement | undefined;
      const rect = el?.getBoundingClientRect?.();
      const inside = rect ? (clientX >= rect.left && clientX <= rect.left + rect.width && clientY >= rect.top && clientY <= rect.top + rect.height) : null;
      const movedToChild = el && relatedTarget && typeof el.contains === 'function' && el.contains(relatedTarget);
      const rightEdge = rect ? rect.left + rect.width : 0;
      const nearRightEdge = rect ? clientX >= rightEdge - 2 : false;
      const leavingToOutside = relatedTarget && el && typeof el.contains === 'function' && !el.contains(relatedTarget);
      if (leavingToOutside) {
        persistedExpandedState = false;
        setIsExpanded(false);
        return;
      }
      if (movedToChild || (inside && !nearRightEdge)) return;
      persistedExpandedState = false;
      setIsExpanded(false);
    },
  } : {};

  return (
    <Animated.View
      ref={navRef}
      className="bg-[#1A1A1A] border-r border-[#2A2A2A] h-full py-6 overflow-hidden"
      style={animatedStyle}
      {...(mouseProps as any)}
    >
      <View className="flex-col h-full">
        {/* Logo/Brand */}
        <View className="mb-6">
          <View className={isExpanded ? '' : 'items-center'}>
            <View style={isExpanded 
              ? { marginTop: -8, marginBottom: -5, marginLeft: -20 }
              : { marginTop: -8, marginBottom: -5 }
            }>
              <SvgXml 
                xml={isExpanded ? furnaceLogoFull : furnaceLogoIcon} 
                width={isExpanded ? 180 : 40} 
                height={isExpanded ? 45 : 45} 
              />
            </View>
          </View>
          {/* Divider */}
          <View className="mt-4 h-px bg-[#2A2A2A]" />
        </View>

        {/* Navigation Links */}
        <View className="mb-6">
          {navItems.map((item) => {
            const active = isActive(item.path);
            return (
              <Pressable
                key={item.path}
                onPress={() => router.push(item.path)}
                className={`py-2 mb-2 rounded-lg border ${
                  isExpanded ? 'px-2' : 'px-0'
                } ${
                  active
                    ? 'bg-[rgba(243,68,13,0.15)] border-brand-orange'
                    : 'bg-[rgba(42,42,42,0.6)] border-[#3A3A3A]'
                }`}
              >
                <View className={`flex-row items-center ${isExpanded ? '' : 'justify-center'}`} style={{ flexShrink: 0 }}>
                  {item.icon && (
                    <View className={isExpanded ? 'mr-3' : ''}>
                      <item.icon size={20} color="#ffffff" />
                    </View>
                  )}
                  {isExpanded && (
                    <Text className="text-white font-instrument text-sm" numberOfLines={1} ellipsizeMode="tail">
                      {item.label}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Spacer to push account section to bottom */}
        <View className="flex-1" />

        {/* Account Section */}
        {user && (
          <View>
            {/* Divider */}
            <View className="h-px bg-[#2A2A2A] mb-4" />

            {/* Current account name + switcher */}
            {account && (
              <View className="mb-3">
                {hasMultipleAccounts ? (
                  <Pressable
                    onPress={() => setSwitcherVisible(true)}
                    className={`flex-row items-center rounded-lg border border-[#3A3A3A] py-2 ${isExpanded ? 'px-2' : 'px-0 justify-center'}`}
                  >
                    {isExpanded ? (
                      <>
                        <Text className="text-gray-300 font-instrument text-sm flex-1" numberOfLines={1} ellipsizeMode="tail">
                          {account.name}
                        </Text>
                        <ChevronDownIcon size={16} color="#9CA3AF" />
                      </>
                    ) : (
                      <ChevronDownIcon size={18} color="#9CA3AF" />
                    )}
                  </Pressable>
                ) : (
                  isExpanded && (
                    <View className="py-1 px-2">
                      <Text className="text-gray-400 font-instrument text-xs" numberOfLines={1} ellipsizeMode="tail">
                        {account.name}
                      </Text>
                    </View>
                  )
                )}
              </View>
            )}

            {/* Account switcher modal */}
            {hasMultipleAccounts && (
              <Modal
                visible={switcherVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setSwitcherVisible(false)}
              >
                <Pressable
                  style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}
                  onPress={() => setSwitcherVisible(false)}
                >
                  <Pressable
                    style={{ backgroundColor: '#1A1A1A', borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, borderColor: '#2A2A2A', padding: 16, paddingBottom: 32 }}
                    onPress={(e) => e.stopPropagation()}
                  >
                    <Text className="text-white font-instrument-semibold text-lg mb-3">Switch account</Text>
                    {memberships.map((m) => (
                      <TouchableOpacity
                        key={m.account.id}
                        onPress={() => {
                          setCurrentAccountId(m.account.id);
                          setSwitcherVisible(false);
                        }}
                        className={`py-3 px-3 rounded-lg mb-1 ${m.account.id === account?.id ? 'bg-brand-orange/20 border border-brand-orange' : 'bg-[#2A2A2A] border border-[#3A3A3A]'}`}
                        activeOpacity={0.7}
                      >
                        <Text className={`font-instrument text-sm ${m.account.id === account?.id ? 'text-brand-orange' : 'text-white'}`}>
                          {m.account.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                      onPress={() => setSwitcherVisible(false)}
                      className="py-2 mt-2"
                      activeOpacity={0.7}
                    >
                      <Text className="text-gray-400 font-instrument text-sm text-center">Cancel</Text>
                    </TouchableOpacity>
                  </Pressable>
                </Pressable>
              </Modal>
            )}

            {/* Settings Button */}
            <Pressable
              onPress={() => router.push('/account')}
              className={`${pathname === '/account' 
                ? 'bg-[rgba(243,68,13,0.15)] border-brand-orange' 
                : 'bg-[rgba(42,42,42,0.6)] border-[#3A3A3A]'
              } border rounded-lg py-2 mb-2 ${isExpanded ? 'px-2' : 'px-0'}`}
            >
              <View className={`flex-row items-center ${isExpanded ? '' : 'justify-center'}`} style={{ flexShrink: 0 }}>
                <View className={isExpanded ? 'mr-3' : ''}>
                  <Cog6ToothIcon size={20} color="#ffffff" />
                </View>
                {isExpanded && (
                  <Text className="text-white font-instrument text-sm" numberOfLines={1} ellipsizeMode="tail">
                    Settings
                  </Text>
                )}
              </View>
            </Pressable>

            {/* Sign Out Button */}
            <Pressable 
              onPress={signOut}
              className={`bg-brand-orange rounded-lg border border-[rgba(248,81,2,0.3)] py-2 ${isExpanded ? 'px-2' : 'px-0'}`}
            >
              <View className={`flex-row items-center ${isExpanded ? '' : 'justify-center'}`} style={{ flexShrink: 0 }}>
                <View className={isExpanded ? 'mr-3' : ''}>
                  <ArrowRightOnRectangleIcon size={20} color="#ffffff" />
                </View>
                {isExpanded && (
                  <Text className="text-white font-instrument text-sm" numberOfLines={1} ellipsizeMode="tail">
                    Sign Out
                  </Text>
                )}
              </View>
            </Pressable>
          </View>
        )}
      </View>
    </Animated.View>
  );
}
