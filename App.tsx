/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { useEffect } from 'react';
import { NewAppScreen } from '@react-native/new-app-screen';
import { StatusBar, StyleSheet, useColorScheme, View, Button, ScrollView } from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { TestHyperSDK } from './TestHyperSDK';
import HyperSdkReact from 'hyper-sdk-react';

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [showHyperTest, setShowHyperTest] = React.useState(false);

  useEffect(() => {
    HyperSdkReact.isInitialised()
  }, [])

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppContent showHyperTest={showHyperTest} setShowHyperTest={setShowHyperTest} />
    </SafeAreaProvider>
  );
}

function AppContent({ showHyperTest, setShowHyperTest }: { showHyperTest: boolean; setShowHyperTest: (show: boolean) => void }) {
  const safeAreaInsets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={styles.toggleContainer}>
        <Button
          title={showHyperTest ? 'Show Default Screen' : 'Show HyperSDK Test'}
          onPress={() => setShowHyperTest(!showHyperTest)}
        />
      </View>
      <ScrollView style={styles.scrollContainer}>
        {showHyperTest ? (
          <TestHyperSDK />
        ) : (
          <NewAppScreen
            templateFileName="App.tsx"
            safeAreaInsets={safeAreaInsets}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toggleContainer: {
    padding: 10,
    backgroundColor: '#f0f0f0',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  scrollContainer: {
    flex: 1,
  },
});

export default App;
