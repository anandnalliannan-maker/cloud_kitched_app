import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'firebase_options.dart';
import 'screens/role_select_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  if (kDebugMode) {
    await FirebaseAuth.instance
        .setSettings(appVerificationDisabledForTesting: true);
  }
  runApp(const CloudKitchenApp());
}

class CloudKitchenApp extends StatelessWidget {
  const CloudKitchenApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Cloud Kitchen',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF0E7C86),
      ),
      home: const RoleSelectScreen(),
    );
  }
}
