import { StyleSheet, Text, View } from 'react-native';

export default function AlbumsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Albums</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
  },
});
