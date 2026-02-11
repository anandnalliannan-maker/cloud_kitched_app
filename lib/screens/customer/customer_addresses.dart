import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../services/address_service.dart';
import 'customer_add_address.dart';

class CustomerAddressesScreen extends StatelessWidget {
  const CustomerAddressesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      return const Scaffold(
        body: Center(child: Text('Please sign in')),
      );
    }

    final addressService = AddressService();
    return Scaffold(
      appBar: AppBar(title: const Text('Saved Addresses')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final count = await addressService.addressCount(user.uid);
          if (!context.mounted) return;
          if (count >= 5) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('You can save up to 5 addresses')),
            );
            return;
          }
          await Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const CustomerAddAddressScreen()),
          );
        },
        icon: const Icon(Icons.add_location_alt),
        label: const Text('Add Address'),
      ),
      body: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        stream:
            FirebaseFirestore.instance.collection('users').doc(user.uid).snapshots(),
        builder: (context, userSnap) {
          final defaultId = userSnap.data?.data()?['defaultAddressId'] as String?;
          return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
            stream: addressService.watchAddresses(user.uid),
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const Center(child: CircularProgressIndicator());
              }

              final docs = snapshot.data?.docs ?? [];
              if (docs.isEmpty) {
                return const Center(child: Text('No saved addresses'));
              }

              return ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
                itemCount: docs.length,
                separatorBuilder: (_, __) => const SizedBox(height: 12),
                itemBuilder: (context, index) {
                  final doc = docs[index];
                  final data = doc.data();
                  final flat = (data['flat'] ?? '').toString();
                  final apartment = (data['apartment'] ?? '').toString();
                  final street = (data['street'] ?? '').toString();
                  final area = (data['area'] ?? '').toString();
                  final isDefault = defaultId == doc.id;

                  final lines = <String>[
                    if (flat.isNotEmpty) flat,
                    if (apartment.isNotEmpty) apartment,
                    if (street.isNotEmpty) street,
                    if (area.isNotEmpty) area,
                  ];

                  return Card(
                    child: ListTile(
                      title: Row(
                        children: [
                          Expanded(child: Text((data['name'] ?? 'Address').toString())),
                          if (isDefault)
                            Container(
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(
                                color: Colors.teal.shade50,
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: const Text(
                                'Default',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                        ],
                      ),
                      subtitle: Text(lines.join(', ')),
                      trailing: PopupMenuButton<String>(
                        onSelected: (value) async {
                          if (value == 'default') {
                            await addressService.setDefaultAddress(
                              uid: user.uid,
                              addressId: doc.id,
                            );
                            if (!context.mounted) return;
                          }
                          if (value == 'edit') {
                            if (!context.mounted) return;
                            await Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => CustomerAddAddressScreen(
                                  addressId: doc.id,
                                  initialData: data,
                                ),
                              ),
                            );
                          }
                          if (value == 'delete') {
                            if (!context.mounted) return;
                            final confirm = await showDialog<bool>(
                              context: context,
                              builder: (_) => AlertDialog(
                                title: const Text('Delete address'),
                                content: const Text(
                                  'Are you sure you want to delete this address?',
                                ),
                                actions: [
                                  TextButton(
                                    onPressed: () => Navigator.of(context).pop(false),
                                    child: const Text('Cancel'),
                                  ),
                                  FilledButton(
                                    onPressed: () => Navigator.of(context).pop(true),
                                    child: const Text('Delete'),
                                  ),
                                ],
                              ),
                            );
                            if (!context.mounted) return;
                            if (confirm == true) {
                              await addressService.deleteAddress(
                                uid: user.uid,
                                addressId: doc.id,
                              );
                            }
                          }
                        },
                        itemBuilder: (_) => [
                          if (!isDefault)
                            const PopupMenuItem(
                              value: 'default',
                              child: Text('Set default'),
                            ),
                          const PopupMenuItem(value: 'edit', child: Text('Edit')),
                          const PopupMenuItem(value: 'delete', child: Text('Delete')),
                        ],
                      ),
                    ),
                  );
                },
              );
            },
          );
        },
      ),
    );
  }
}
