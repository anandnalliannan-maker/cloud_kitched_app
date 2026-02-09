import 'package:flutter/material.dart';
import 'screens/role_select_screen.dart';

void main() {
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
